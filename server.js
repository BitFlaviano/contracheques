require('dotenv').config();
const express = require('express');
const cors = require('cors');
const multer = require('multer');
const { createClient } = require('@supabase/supabase-js');
const WebSocket = require('ws');
const { PDFDocument } = require('pdf-lib');
const path = require('path');
const { Resend } = require('resend');
const { GoogleGenAI } = require('@google/genai');
const pdfParse = require('pdf-parse');
const { processarESalvarNaFila } = require('./ai/index');
const { classificarDocumento } = require('./ai/DocumentClassifier');
const { listarFila, resolverItem } = require('./ai/ReviewQueue');
const { buscarDocumentos } = require('./scripts/emailFetcher');
const crypto = require('crypto');
const sharp = require('sharp');

const sessoesCorte = new Map();
setInterval(() => {
    const now = Date.now();
    for (const [id, s] of sessoesCorte) {
        if (now - s.criadaEm > 30 * 60 * 1000) sessoesCorte.delete(id);
    }
}, 60 * 1000);

const app = express();
app.use(express.json());
app.use(cors());
app.use(express.static(path.join(__dirname, 'public')));

const SUPABASE_URL = 'https://uatryxvylqwslnaxggjk.supabase.co';
const SUPABASE_SERVICE_ROLE = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InVhdHJ5eHZ5bHF3c2xuYXhnZ2prIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3NzAwODk5OSwiZXhwIjoyMDkyNTg0OTk5fQ.Sy3jX2ZbRFIHR2GI_8TrOE4uxMQz__K3MqK-LClsMwg';
const supabaseAdmin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE, {
    realtime: { transport: WebSocket }
});
const gemini = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
const upload = multer({ storage: multer.memoryStorage() });
const resend = new Resend(process.env.RESEND_API_KEY);

function smtpConfigurado() {
    return !!process.env.RESEND_API_KEY;
}

async function enviarEmail({ from, to, replyTo, subject, html, attachments }) {
    const payload = { from, to, subject, html };
    if (replyTo) payload.replyTo = replyTo;
    if (attachments && attachments.length > 0) {
        payload.attachments = attachments.map(a => ({ filename: a.filename, content: a.content }));
    }
    return await resend.emails.send(payload);
}

async function validarAdmin(req, res) {
    const authHeader = req.headers.authorization || "";
    const token = authHeader.startsWith("Bearer ")
        ? authHeader.slice(7)
        : null;

    if (!token) {
        res.status(403).json({ erro: "Acesso negado" });
        return null;
    }

    const { data, error } = await supabaseAdmin.auth.getUser(token);

    if (error || data.user?.user_metadata?.tipo !== "admin") {
        res.status(403).json({ erro: "Acesso negado" });
        return null;
    }

    return data.user;
}

app.get('/metricas', async (req, res) => {
    try {
        const admin = await validarAdmin(req, res);
        if (!admin) return;

        const dias = req.query.dias || '30';
        const inicio = periodoInicio(dias);

        const [
            usersResp,
            acessosResp,
            solicitacoesResp,
            atestadosResp,
            confirmacoesResp,
            pendentesResp
        ] = await Promise.all([
            supabaseAdmin.auth.admin.listUsers({ perPage: 1000 }),
            lerTabela('portal_acessos'),
            lerTabela('solicitacoes_contracheques'),
            lerTabela('atestados'),
            lerTabela('confirmacoes_contracheque'),
            lerTabela('documentos_pendentes')
        ]);

        const usuarios = usersResp.data?.users || [];
        const avisos = [
            acessosResp.aviso && `portal_acessos: ${acessosResp.aviso}`,
            solicitacoesResp.aviso && `solicitacoes_contracheques: ${solicitacoesResp.aviso}`,
            atestadosResp.aviso && `atestados: ${atestadosResp.aviso}`,
            confirmacoesResp.aviso && `confirmacoes_contracheque: ${confirmacoesResp.aviso}`,
            pendentesResp.aviso && `documentos_pendentes: ${pendentesResp.aviso}`
        ].filter(Boolean);

        const acessos = acessosResp.data.filter(item => dentroDoPeriodo(item, inicio));
        const solicitacoes = solicitacoesResp.data.filter(item => dentroDoPeriodo(item, inicio));
        const atestados = atestadosResp.data.filter(item => dentroDoPeriodo(item, inicio));
        const confirmacoes = confirmacoesResp.data.filter(item => !item.visualizada && dentroDoPeriodo(item, inicio));
        const pendentes = pendentesResp.data.filter(item => !item.vinculado_em);

        const porUsuario = new Map();

        for (const user of usuarios) {
            porUsuario.set(user.id, {
                user_id: user.id,
                nome: user.user_metadata?.full_name || user.email || 'Sem nome',
                email: user.email || '',
                tipo: user.user_metadata?.tipo || '',
                acessos: 0,
                solicitacoes: 0,
                atestados: 0,
                confirmacoes: 0
            });
        }

        acessos.forEach(item => incPorUsuario(porUsuario, item, 'acessos'));
        solicitacoes.forEach(item => incPorUsuario(porUsuario, item, 'solicitacoes'));
        atestados.forEach(item => incPorUsuario(porUsuario, item, 'atestados'));
        confirmacoes.forEach(item => incPorUsuario(porUsuario, item, 'confirmacoes'));

        const porFuncionario = Array.from(porUsuario.values())
            .sort((a, b) =>
                (b.acessos + b.solicitacoes + b.atestados + b.confirmacoes) -
                (a.acessos + a.solicitacoes + a.atestados + a.confirmacoes)
            );

        const solicitacoesPorStatus = solicitacoes.reduce((acc, item) => {
            const status = item.status || 'sem_status';
            acc[status] = (acc[status] || 0) + 1;
            return acc;
        }, {});

        const pendentesPorTipo = pendentes.reduce((acc, item) => {
            const tipo = item.tipo_detectado || 'nao_identificado';
            acc[tipo] = (acc[tipo] || 0) + 1;
            return acc;
        }, {});

        res.json({
            periodo: {
                dias,
                inicio: inicio?.toISOString() || null,
                fim: new Date().toISOString()
            },
            totais: {
                funcionarios: usuarios.length,
                acessos: acessos.length,
                solicitacoes: solicitacoes.length,
                atestados: atestados.length,
                confirmacoes: confirmacoes.length,
                pendentes: pendentes.length,
                funcionarios_sem_acesso: porFuncionario.filter(item => item.acessos === 0).length
            },
            porFuncionario,
            solicitacoesPorStatus,
            pendentesPorTipo,
            avisos
        });
    } catch (err) {
        res.status(500).json({ erro: err.message });
    }
});

app.post('/metricas/acesso', async (req, res) => {
    try {
        const user = await validarUsuario(req, res);
        if (!user) return;

        const registro = {
            user_id: user.id,
            nome_usuario: user.user_metadata?.full_name || '',
            email_usuario: user.email || '',
            tipo_usuario: user.user_metadata?.tipo || '',
            caminho: String(req.body?.caminho || req.body?.path || '').slice(0, 200),
            user_agent: String(req.headers['user-agent'] || '').slice(0, 500),
            criado_em: new Date().toISOString()
        };

        const { error } = await supabaseAdmin
            .from('portal_acessos')
            .insert(registro);

        if (error) {
            console.warn('Acesso nao registrado:', error.message);
            return res.json({ sucesso: false, aviso: error.message });
        }

        res.json({ sucesso: true });
    } catch (err) {
        res.status(500).json({ erro: err.message });
    }
});


async function validarUsuario(req, res) {
    const authHeader = req.headers.authorization || "";
    const token = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : null;
    if (!token) { res.status(403).json({ erro: "Acesso negado" }); return null; }
    const { data, error } = await supabaseAdmin.auth.getUser(token);
    if (error || !data.user) { res.status(403).json({ erro: "Acesso negado" }); return null; }
    return data.user;
}

function gerarTimestamp() {
    const agora = new Date();
    return `${agora.getFullYear()}${String(agora.getMonth() + 1).padStart(2, '0')}${String(agora.getDate()).padStart(2, '0')}_${String(agora.getHours()).padStart(2, '0')}${String(agora.getMinutes()).padStart(2, '0')}`;
}

function detectarMediaType(nomeArquivo) {
    const ext = (nomeArquivo || '').split('.').pop().toLowerCase();
    const tipos = { pdf: 'application/pdf', jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png' };
    return tipos[ext] || 'application/pdf';
}

function normalizarTexto(texto = "") {
    return texto.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toUpperCase().trim();
}

function cpfLimpo(cpf = "") {
    return String(cpf).replace(/\D/g, "");
}

function dataDaPasta(nomePasta = "") {
    const match = String(nomePasta).match(/^(\d{4})(\d{2})(\d{2})/);
    if (!match) return null;
    const data = new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
    return Number.isNaN(data.getTime()) ? null : data;
}

function dentroDosUltimosMeses(data, meses) {
    if (!data) return false;
    const limite = new Date();
    limite.setMonth(limite.getMonth() - meses);
    limite.setHours(0, 0, 0, 0);
    return data >= limite;
}

function mesmoMesAtual(data) {
    if (!data) return false;
    const hoje = new Date();
    return data.getFullYear() === hoje.getFullYear() && data.getMonth() === hoje.getMonth();
}

function identificarUsuario(texto, usuarios) {
    if (!texto) return null;
    const textoNormalizado = texto.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toUpperCase();
    for (let user of usuarios) {
        const nomeUser = user.user_metadata?.full_name;
        if (!nomeUser) continue;
        const nomeNormalizado = nomeUser.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toUpperCase();
        if (textoNormalizado.includes(nomeNormalizado)) return nomeUser.toUpperCase();
    }
    return null;
}

function extrairMes(texto) {
    const meses = ['janeiro','fevereiro','marco','abril','maio','junho','julho','agosto','setembro','outubro','novembro','dezembro'];
    const textoLower = texto.toLowerCase();
    for (let mes of meses) {
        if (textoLower.includes(mes)) return mes;
    }
    return null;
}

function extrairNomeDoTexto(texto) {
    if (!texto) return null;
    const linhas = texto.split('\n');
    for (const linha of linhas) {
        const l = linha.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toUpperCase().trim();
        if (!l || l.length < 5) continue;
        // Padrões comuns: "NOME: ...", "FUNCIONARIO: ...", "COLABORADOR: ...", "EMPREGADO: ..."
        const match = l.match(/^(?:NOME|FUNCIONARIO|COLABORADOR|EMPREGADO|TRABALHADOR)\s*[:]\s*(.+)/);
        if (match) {
            const nome = match[1].trim();
            if (nome.length >= 5 && /^[A-Z\s]+$/.test(nome)) return nome;
        }
    }
    return null;
}

async function salvarDocumentoPendente({ buffer, nomeArquivo, nomeExtraido, cpfExtraido, tipo, mes, ano }) {
    const nomeSeguro = path.basename(nomeArquivo || `pendente_${Date.now()}.pdf`);
    const caminhoPendente = `pendentes/${Date.now()}_${nomeSeguro}`;
    const { error: uploadError } = await supabaseAdmin.storage
        .from('pendentes').upload(caminhoPendente, buffer, { contentType: 'application/pdf', upsert: true });
    if (uploadError) throw new Error(`Storage: ${uploadError.message}`);
    let dbError;
    try {
        ({ error: dbError } = await supabaseAdmin
            .from('documentos_pendentes').insert({
                nome_arquivo: nomeSeguro, caminho: caminhoPendente,
                nome_extraido: nomeExtraido || null, cpf_extraido: cpfExtraido || null,
                tipo_detectado: tipo || null,
                mes_detectado: mes || null, ano_detectado: ano || null,
                criado_em: new Date().toISOString()
            }));
    } catch { }
    if (dbError && dbError.message?.includes('cpf_extraido')) {
        // coluna cpf_extraido ainda não existe — insere sem ela
        ({ error: dbError } = await supabaseAdmin
            .from('documentos_pendentes').insert({
                nome_arquivo: nomeSeguro, caminho: caminhoPendente,
                nome_extraido: nomeExtraido || null,
                tipo_detectado: tipo || null,
                mes_detectado: mes || null, ano_detectado: ano || null,
                criado_em: new Date().toISOString()
            }));
    }
    if (dbError) throw new Error(`DB: ${dbError.message}`);
    return caminhoPendente;
}

async function garantirBuckets() {
    const buckets = ['contracheques', 'folhas-ponto', 'atestados', 'comprovantes', 'perfis', 'pendentes'];
    for (const bucket of buckets) {
        const { data } = await supabaseAdmin.storage.getBucket(bucket);
        if (!data) await supabaseAdmin.storage.createBucket(bucket, { public: bucket === 'perfis' });
    }
}

garantirBuckets().catch(err => console.warn("Aviso ao verificar buckets:", err.message));

// Cria a coluna cpf_extraido se não existir (necessário para o fluxo de IA)
(async () => {
    try {
        await supabaseAdmin.from('documentos_pendentes').select('cpf_extraido').limit(1);
    } catch {
        console.log('Coluna cpf_extraido ausente — criando via SQL direto...');
        try {
            await fetch('https://api.supabase.com/v1/projects/uatryxvylqwslnaxggjk/sql', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${SUPABASE_SERVICE_ROLE}` },
                body: JSON.stringify({ query: 'ALTER TABLE public.documentos_pendentes ADD COLUMN IF NOT EXISTS cpf_extraido TEXT;' })
            });
        } catch {}
    }
})();

// Cria a coluna visualizada em confirmacoes_contracheque se não existir
(async () => {
    try {
        await supabaseAdmin.from('confirmacoes_contracheque').select('visualizada').limit(1);
    } catch {
        console.log('Coluna visualizada ausente em confirmacoes_contracheque — criando via SQL direto...');
        try {
            await fetch('https://api.supabase.com/v1/projects/uatryxvylqwslnaxggjk/sql', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${SUPABASE_SERVICE_ROLE}` },
                body: JSON.stringify({ query: 'ALTER TABLE public.confirmacoes_contracheque ADD COLUMN IF NOT EXISTS visualizada BOOLEAN DEFAULT FALSE;' })
            });
        } catch {}
    }
})();

function lerTabela(nomeTabela) {
    return supabaseAdmin.from(nomeTabela).select('*').then(
        ({ data, error }) => error ? { data: [], aviso: error.message } : { data: data || [], aviso: null }
    ).catch(err => ({ data: [], aviso: err.message }));
}

function periodoInicio(dias) {
    if (!dias || dias === 'todos') return null;
    const numero = Number(dias);
    if (!numero || numero <= 0) return null;
    const inicio = new Date();
    inicio.setDate(inicio.getDate() - numero);
    inicio.setHours(0, 0, 0, 0);
    return inicio;
}

function incPorUsuario(mapa, item, campo) {
    const chave = item.user_id || item.id || item.email_usuario || item.nome_usuario || 'sem_usuario';
    if (!mapa.has(chave)) {
        mapa.set(chave, {
            user_id: item.user_id || null,
            nome: item.nome_usuario || item.nome || 'Sem nome',
            email: item.email_usuario || item.email || '',
            tipo: item.tipo_usuario || item.tipo || '',
            acessos: 0, solicitacoes: 0, atestados: 0, confirmacoes: 0
        });
    }
    mapa.get(chave)[campo]++;
}

function dentroDoPeriodo(item, inicio) {
    if (!inicio) return true;
    const valor = item.criado_em || item.created_at || item.data_confirmacao || item.data_resposta || item.baixado_em || item.vinculado_em;
    if (!valor) return false;
    const data = new Date(valor);
    return !Number.isNaN(data.getTime()) && data >= inicio;
}

function dataRegistro(item = {}) {
    const valor = item.criado_em || item.created_at || item.data_confirmacao || item.data_resposta || item.baixado_em || item.vinculado_em;
    if (!valor) return null;
    const data = new Date(valor);
    return Number.isNaN(data.getTime()) ? null : data;
}

function normalizarYCorte(yCorte) {
    const valor = Number(yCorte);
    if (!Number.isFinite(valor)) return null;
    if (valor < 0.05 || valor > 0.95) return null;
    return valor;
}

async function extrairMetadePagina(pdfDoc, pageIndex, posicao, yCorte) {
    const destDoc = await PDFDocument.create();
    const [page] = await destDoc.copyPages(pdfDoc, [pageIndex]);
    destDoc.addPage(page);

    const { width, height } = page.getSize();
    const yFracao = normalizarYCorte(yCorte) ?? 0.5;
    const yPdf = height * (1 - yFracao);

    if (posicao === 'topo') {
        page.setMediaBox(0, yPdf, width, height - yPdf);
        page.setCropBox(0, yPdf, width, height - yPdf);
    } else {
        page.setMediaBox(0, 0, width, yPdf);
        page.setCropBox(0, 0, width, yPdf);
    }

    return Buffer.from(await destDoc.save());
}

async function processarPaginaComprovante({ pagePdfBuffer, pageNumber, ySplit = 0.404 }) {
    let textoPagina = '';
    try {
        const dadosPagina = await pdfParse(pagePdfBuffer);
        textoPagina = dadosPagina.text || '';
    } catch { }

    const doc = await PDFDocument.load(pagePdfBuffer);
    const topo = await extrairMetadePagina(doc, 0, 'topo', ySplit);
    const baixo = await extrairMetadePagina(doc, 0, 'baixo', ySplit);
    return { dividir: true, topo, baixo, textoPagina };
}

// =============================
// PROCESSAR PDF POR USUÁRIO (HÍBRIDO: pdf-parse → IA)
// =============================
async function processarPdfPorUsuario(req, res, bucket) {
    try {
        const admin = await validarAdmin(req, res);
        if (!admin) return;

        if (!req.file) return res.status(400).json({ erro: "Arquivo não enviado" });

        const pdfBuffer = req.file.buffer;
        const pdfDoc = await PDFDocument.load(pdfBuffer);
        const totalPaginas = pdfDoc.getPageCount();
        const pastaUpload = gerarTimestamp();

        const { data: usersData, error: usersError } = await supabaseAdmin.auth.admin.listUsers();
        if (usersError) return res.status(500).json({ erro: "Erro ao buscar usuários" });
        const usuarios = usersData.users;

        let salvouAlgum = false;
        let totalPendentes = 0;

        for (let i = 0; i < totalPaginas; i++) {
            const novoPdf = await PDFDocument.create();
            const [pagina] = await novoPdf.copyPages(pdfDoc, [i]);
            novoPdf.addPage(pagina);
            const pdfBytes = await novoPdf.save();
            const pdfBuf = Buffer.from(pdfBytes);

            // Detecta se a página é comprovante pelo texto (funciona mesmo se bucket for outro)
            let textoPagina = '';
            let ehComprovante = bucket === 'comprovantes';
            try {
                const dadosPagina = await pdfParse(pdfBuf);
                textoPagina = dadosPagina.text || '';
                if (!ehComprovante) ehComprovante = /comprovante|pagamento/i.test(textoPagina);
            } catch { }

            if (ehComprovante) {
                const divisao = await processarPaginaComprovante({
                    pagePdfBuffer: pdfBuf, pageNumber: i + 1
                });

                const metades = divisao.dividir
                    ? [{ buffer: divisao.topo, sufixo: '_topo', texto: divisao.textoPagina },
                       { buffer: divisao.baixo, sufixo: '_baixo', texto: divisao.textoPagina }]
                    : [{ buffer: divisao.buffer, sufixo: '', texto: divisao.textoPagina }];

                for (const metade of metades) {
                    const nome = metade.texto ? identificarUsuario(metade.texto, usuarios) : null;
                    const mes = metade.texto ? extrairMes(metade.texto) : null;
                    const sufixo = metade.sufixo || '';

                    if (nome) {
                        const nomeArquivo = `${nome} ${mes || 'sem-mes'}${sufixo}.pdf`;
                        const caminho = `${pastaUpload}/${nomeArquivo}`;
                        const { error } = await supabaseAdmin.storage
                            .from(bucket).upload(caminho, metade.buffer, { contentType: 'application/pdf', upsert: true });
                        if (error) console.log("ERRO STORAGE:", error.message);
                        else { console.log(`SALVO (pdf-parse): ${bucket}/${caminho}`); salvouAlgum = true; }
                    } else {
                        const nomeExtraidoTexto = metade.texto ? extrairNomeDoTexto(metade.texto) : null;
                        if (nomeExtraidoTexto) {
                            await salvarDocumentoPendente({
                                buffer: metade.buffer, nomeArquivo: `pagina_${i + 1}${sufixo}.pdf`,
                                nomeExtraido: nomeExtraidoTexto, cpfExtraido: null, tipo: bucket, mes, ano: new Date().getFullYear()
                            });
                            totalPendentes++;
                            continue;
                        }
                        let cpfExtraidoComprovante = null;
                        try {
                            const resultado = await processarESalvarNaFila(gemini, supabaseAdmin, {
                                fileBuffer: metade.buffer, mediaType: 'application/pdf',
                                caminho: `${pastaUpload}/pagina_${i + 1}${sufixo}.pdf`, bucket
                            });
                            if (resultado.sucesso) {
                                const dados = resultado.dados;
                                const nomeExtraido = dados.nome_funcionario || dados.funcionario || dados.nome || null;
                                cpfExtraidoComprovante = dados.cpf || null;
                                if (nomeExtraido) {
                                    const nomeNormalizado = normalizarTexto(nomeExtraido);
                                    const usuarioMatch = usuarios.find(u => {
                                        const n = normalizarTexto(u.user_metadata?.full_name || '');
                                        return n && nomeNormalizado.includes(n);
                                    });
                                    const nomeFinal = usuarioMatch ? normalizarTexto(usuarioMatch.user_metadata?.full_name) : nomeNormalizado;
                                    const mesRef = dados.competencia || dados.periodo || mes ||
                                        new Date().toLocaleString('pt-BR', { month: 'long' }).toLowerCase();
                                    const nomeCompleto = `${nomeFinal} ${mesRef}${sufixo}.pdf`;
                                    const caminhoIA = `${pastaUpload}/${nomeCompleto}`;
                                    const { error: upErr } = await supabaseAdmin.storage
                                        .from(bucket).upload(caminhoIA, metade.buffer, { contentType: 'application/pdf', upsert: true });
                                    if (!upErr) {
                                        console.log(`SALVO (IA): ${bucket}/${caminhoIA} | Confiança: ${resultado.confianca?.confianca_geral}%`);
                                        salvouAlgum = true;
                                        continue;
                                    }
                                }
                            }
                        } catch (aiErr) {
                            console.error(`Página ${i + 1}${sufixo} erro IA:`, aiErr.message);
                        }
                        await salvarDocumentoPendente({
                            buffer: metade.buffer, nomeArquivo: `pagina_${i + 1}${sufixo}.pdf`,
                            nomeExtraido: null, cpfExtraido: cpfExtraidoComprovante, tipo: bucket, mes: null, ano: new Date().getFullYear()
                        });
                        totalPendentes++;
                    }
                }
                continue;
            }

            // === ETAPA 1: pdf-parse + regex (para contracheques/folhas-ponto) ===
            const nome = textoPagina ? identificarUsuario(textoPagina, usuarios) : null;
            const mes = textoPagina ? extrairMes(textoPagina) : null;

            if (nome) {
                const nomeArquivo = `${nome} ${mes || 'sem-mes'}.pdf`;
                const caminho = `${pastaUpload}/${nomeArquivo}`;
                const { error } = await supabaseAdmin.storage
                    .from(bucket).upload(caminho, pdfBytes, { contentType: 'application/pdf', upsert: true });
                if (error) console.log("ERRO STORAGE:", error.message);
                else { console.log(`SALVO (pdf-parse): ${bucket}/${caminho}`); salvouAlgum = true; }
                continue;
            }

            // === ETAPA 1.5: extrair nome por regex do texto ===
            const nomeExtraidoTexto = textoPagina ? extrairNomeDoTexto(textoPagina) : null;
            if (nomeExtraidoTexto) {
                await salvarDocumentoPendente({
                    buffer: pdfBytes, nomeArquivo: `pagina_${i + 1}.pdf`,
                    nomeExtraido: nomeExtraidoTexto, cpfExtraido: null, tipo: bucket, mes, ano: new Date().getFullYear()
                });
                totalPendentes++;
                continue;
            }

            // === ETAPA 2: fallback IA (Gemini) ===
            console.log(`Página ${i + 1}: pdf-parse não identificou, acionando IA...`);
            try {
                const resultado = await processarESalvarNaFila(gemini, supabaseAdmin, {
                    fileBuffer: pdfBytes, mediaType: 'application/pdf',
                    caminho: `${pastaUpload}/pagina_${i + 1}.pdf`, bucket
                });

                if (!resultado.sucesso) {
                    console.log(`Página ${i + 1} IA: ${resultado.erro}`);
                    await salvarDocumentoPendente({
                        buffer: pdfBytes, nomeArquivo: `pagina_${i + 1}.pdf`,
                        nomeExtraido: null, cpfExtraido: null, tipo: bucket, mes: null, ano: new Date().getFullYear()
                    });
                    totalPendentes++;
                    continue;
                }

                const dados = resultado.dados || {};
                const confianca = resultado.confianca?.confianca_geral ?? 0;

                if (confianca < 60) {
                    console.log(`Página ${i + 1} IA: confiança ${confianca} abaixo de 60, enviando para pendentes.`);
                    await salvarDocumentoPendente({
                        buffer: pdfBytes, nomeArquivo: `pagina_${i + 1}.pdf`,
                        nomeExtraido: null, cpfExtraido: null, tipo: bucket, mes: null, ano: new Date().getFullYear()
                    });
                    totalPendentes++;
                    continue;
                }

                const nomeExtraido = dados.nome_funcionario || dados.funcionario || dados.nome || null;
                const cpfExtraidoIA = dados.cpf || null;
                if (!nomeExtraido) {
                    console.log(`Página ${i + 1} IA: nome não extraído, enviando para pendentes.`);
                    await salvarDocumentoPendente({
                        buffer: pdfBytes, nomeArquivo: `pagina_${i + 1}.pdf`,
                        nomeExtraido: null, cpfExtraido: cpfExtraidoIA, tipo: bucket, mes: null, ano: new Date().getFullYear()
                    });
                    totalPendentes++;
                    continue;
                }

                const nomeNormalizado = normalizarTexto(nomeExtraido);
                const usuarioMatch = usuarios.find(u => {
                    const n = normalizarTexto(u.user_metadata?.full_name || '');
                    return n && nomeNormalizado.includes(n);
                });
                const nomeFinal = usuarioMatch ? normalizarTexto(usuarioMatch.user_metadata?.full_name) : nomeNormalizado;
                const mesRef = dados.competencia || dados.periodo ||
                    new Date().toLocaleString('pt-BR', { month: 'long' }).toLowerCase();
                const nomeCompleto = `${nomeFinal} ${mesRef}.pdf`;
                const caminhoIA = `${pastaUpload}/${nomeCompleto}`;
                const { error: upErr } = await supabaseAdmin.storage
                    .from(bucket).upload(caminhoIA, pdfBytes, { contentType: 'application/pdf', upsert: true });
                if (!upErr) {
                    console.log(`SALVO (IA): ${bucket}/${caminhoIA} | Confiança: ${confianca}%`);
                    salvouAlgum = true;
                    continue;
                }
            } catch (aiErr) {
                console.error(`Página ${i + 1} erro IA:`, aiErr.message);
            }

            await salvarDocumentoPendente({
                buffer: pdfBytes, nomeArquivo: `pagina_${i + 1}.pdf`,
                nomeExtraido: null, cpfExtraido: null, tipo: bucket, mes: null, ano: new Date().getFullYear()
            });
            totalPendentes++;
        }

        if (!salvouAlgum && totalPendentes > 0) {
            return res.json({
                sucesso: true,
                status_email: 'nao_enviado',
                pendentes: totalPendentes,
                aviso: 'Documentos enviados para pendentes.'
            });
        }

        if (!salvouAlgum) return res.status(400).json({ erro: "Nenhum arquivo foi salvo." });

        res.json({ sucesso: true, status_email: 'nao_enviado', pendentes: totalPendentes });

    } catch (err) {
        console.error("ERRO:", err);
        res.status(500).json({ erro: err.message });
    }
}

// =============================
// LISTAR DOCUMENTOS DO USUÁRIO
// =============================
async function listarDocumentosUsuario(user, tipo) {
    let bucket = 'contracheques';
    if (tipo === 'folha-ponto') bucket = 'folhas-ponto';
    if (tipo === 'comprovante') bucket = 'comprovantes';

    const nomeNormalizado = normalizarTexto(user.user_metadata?.full_name || "");
    const resultado = [];

    const { data: pastas, error: erroPastas } = await supabaseAdmin.storage
        .from(bucket).list('', { limit: 1000 });

    if (erroPastas) throw erroPastas;

    let liberarAntigos = false;

    if (tipo === 'contracheque') {
        const { data: solicitacoes } = await supabaseAdmin
            .from('solicitacoes_contracheques').select('*')
            .eq('user_id', user.id).eq('status', 'aprovado');

        liberarAntigos = (solicitacoes || []).some(item => {
            const validoAte = new Date(item.valido_ate || 0);
            return validoAte >= new Date();
        });
    }

    for (const pasta of pastas || []) {
        const dataPasta = dataDaPasta(pasta.name);
        const pastaPermitida = tipo === 'folha-ponto'
            ? mesmoMesAtual(dataPasta)
            : dentroDosUltimosMeses(dataPasta, 3) || liberarAntigos;

        if (!pastaPermitida) continue;

        const { data: arquivos } = await supabaseAdmin.storage
            .from(bucket).list(pasta.name, { limit: 1000 });

        for (const arquivo of arquivos || []) {
            const nomeArquivo = normalizarTexto(arquivo.name);
            if (!nomeArquivo.includes(nomeNormalizado)) continue;
            resultado.push({
                nome: arquivo.name,
                caminho: `${pasta.name}/${arquivo.name}`,
                tipo, bucket,
                data_upload: dataPasta?.toISOString() || null
            });
        }
    }

    return resultado.sort((a, b) => new Date(b.data_upload || 0) - new Date(a.data_upload || 0));
}

// =============================
// ROTAS: UPLOAD
// =============================
app.post('/upload', upload.single('pdf'), async (req, res) => {
    await processarPdfPorUsuario(req, res, 'contracheques');
});

app.post('/upload-ponto', upload.single('pdf'), async (req, res) => {
    await processarPdfPorUsuario(req, res, 'folhas-ponto');
});



app.post('/upload-comprovantes', upload.single('pdf'), async (req, res) => {
    await processarPdfPorUsuario(req, res, 'comprovantes');
});

async function detectarTipoDocumento(pdfBuffer) {
    let texto = '';
    try {
        const dados = await pdfParse(pdfBuffer);
        texto = dados.text || '';
    } catch { }
    const t = texto.toLowerCase();
    if (/comprovante/i.test(t)) return 'comprovantes';
    if (/folha\s*de\s*ponto/i.test(t)) return 'folhas-ponto';
    if (/contracheque/i.test(t)) return 'contracheques';
    if (/salario|salário|proventos|descontos/i.test(t)) return 'contracheques';
    if (/batida|ponto|horas?\s*extras?/i.test(t)) return 'folhas-ponto';
    if (/pagamento/i.test(t)) return 'comprovantes';
    return null;
}

app.post('/upload-inteligente', upload.single('pdf'), async (req, res) => {
    try {
        const admin = await validarAdmin(req, res);
        if (!admin) return;
        if (!req.file) return res.status(400).json({ erro: 'Arquivo não enviado' });
        const pdfBuffer = req.file.buffer;

        // Tipo manual pelo usuário
        const tipoManual = req.body.tipo_manual;
        if (tipoManual === 'comprovantes') {
            const sessionId = crypto.randomUUID();
            sessoesCorte.set(sessionId, {
                pdfBuffer, bucket: 'comprovantes',
                nomeArquivo: req.file.originalname,
                totalPaginas: (await PDFDocument.load(pdfBuffer)).getPageCount(),
                criadaEm: Date.now()
            });
            return res.json({ precisaCorte: true, sessionId, totalPaginas: sessoesCorte.get(sessionId).totalPaginas });
        }

        let bucket = null;
        if (tipoManual) {
            bucket = tipoManual;
        } else {
            bucket = await detectarTipoDocumento(pdfBuffer);
        }
        if (!bucket) {
            try {
                const base64 = pdfBuffer.toString('base64');
                const tipo = await classificarDocumento(gemini, base64, 'application/pdf');
                bucket = tipo === 'contracheque' ? 'contracheques'
                    : tipo === 'folha-ponto' ? 'folhas-ponto'
                    : tipo === 'comprovante' ? 'comprovantes'
                    : null;
                console.log(`Classificação IA: ${tipo || 'indefinido'} → bucket: ${bucket}`);
            } catch (e) {
                console.log("Classificação IA falhou:", e.message);
            }
        }
        if (!bucket) bucket = 'contracheques';
        console.log(`Bucket final: ${bucket}`);

        // Detecta se precisa de corte visual (comprovante)
        let precisaCorte = bucket === 'comprovantes';
        if (!precisaCorte) {
            try {
                const dados = await pdfParse(pdfBuffer);
                if (/comprovante|pagamento/i.test(dados.text || '')) {
                    precisaCorte = true;
                    bucket = 'comprovantes';
                    console.log(`Corte ativado por texto: comprovante/pagamento encontrado → bucket alterado para comprovantes`);
                }
            } catch {}
        }

        if (precisaCorte) {
            const sessionId = crypto.randomUUID();
            sessoesCorte.set(sessionId, {
                pdfBuffer, bucket,
                nomeArquivo: req.file.originalname,
                totalPaginas: (await PDFDocument.load(pdfBuffer)).getPageCount(),
                criadaEm: Date.now()
            });
            return res.json({ precisaCorte: true, sessionId, totalPaginas: sessoesCorte.get(sessionId).totalPaginas });
        }

        req.file.bucket = bucket;
        await processarPdfPorUsuario(req, res, bucket);
    } catch (err) {
        res.status(500).json({ erro: err.message });
    }
});

// =============================
// PREVIEW & CONFIRMAR CORTE (comprovantes)
// =============================

app.get('/preview-corte/:sessionId', async (req, res) => {
    const sessao = sessoesCorte.get(req.params.sessionId);
    if (!sessao) return res.status(404).json({ erro: 'Sessão expirada' });
    try {
        const pdfDoc = await PDFDocument.load(sessao.pdfBuffer);
        const firstPagePdf = await PDFDocument.create();
        const [page] = await firstPagePdf.copyPages(pdfDoc, [0]);
        firstPagePdf.addPage(page);
        const pageBytes = await firstPagePdf.save();
        res.type('application/pdf').send(Buffer.from(pageBytes));
    } catch (err) {
        res.status(500).json({ erro: err.message });
    }
});

app.post('/confirmar-corte', async (req, res) => {
    try {
        const admin = await validarAdmin(req, res);
        if (!admin) return;
        const { sessionId, ySplit } = req.body;
        if (!sessionId) return res.status(400).json({ erro: 'sessionId obrigatório' });
        const sessao = sessoesCorte.get(sessionId);
        if (!sessao) return res.status(400).json({ erro: 'Sessão expirada' });
        sessoesCorte.delete(sessionId);

        const pastaUpload = gerarTimestamp();
        const { data: usersData } = await supabaseAdmin.auth.admin.listUsers();
        const usuarios = usersData.users || [];

        const pdfDoc = await PDFDocument.load(sessao.pdfBuffer);
        const totalPaginas = pdfDoc.getPageCount();
        let salvouAlgum = false;
        let totalPendentes = 0;
        const pos = typeof ySplit === 'number' ? ySplit : 0.404;

        for (let i = 0; i < totalPaginas; i++) {
            const novoPdf = await PDFDocument.create();
            const [pagina] = await novoPdf.copyPages(pdfDoc, [i]);
            novoPdf.addPage(pagina);
            const pdfBytes = await novoPdf.save();
            const pdfBuf = Buffer.from(pdfBytes);

            let textoPagina = '';
            try {
                const dadosPagina = await pdfParse(pdfBuf);
                textoPagina = dadosPagina.text || '';
            } catch {}

            const divisao = await processarPaginaComprovante({
                pagePdfBuffer: pdfBuf, pageNumber: i + 1, ySplit: pos
            });

            const metades = [
                { buffer: divisao.topo, sufixo: '_topo', texto: divisao.textoPagina },
                { buffer: divisao.baixo, sufixo: '_baixo', texto: divisao.textoPagina }
            ];

            for (const metade of metades) {
                const nome = metade.texto ? identificarUsuario(metade.texto, usuarios) : null;
                const mes = metade.texto ? extrairMes(metade.texto) : null;
                const sufixo = metade.sufixo || '';

                if (nome) {
                    const nomeArquivo = `${nome} ${mes || 'sem-mes'}${sufixo}.pdf`;
                    const caminho = `${pastaUpload}/${nomeArquivo}`;
                    const { error } = await supabaseAdmin.storage
                        .from(sessao.bucket).upload(caminho, metade.buffer, { contentType: 'application/pdf', upsert: true });
                    if (error) console.log("ERRO STORAGE:", error.message);
                    else { console.log(`SALVO (pdf-parse): ${sessao.bucket}/${caminho}`); salvouAlgum = true; }
                } else {
                    const nomeExtraidoTexto = metade.texto ? extrairNomeDoTexto(metade.texto) : null;
                    if (nomeExtraidoTexto) {
                        await salvarDocumentoPendente({
                            buffer: metade.buffer, nomeArquivo: `pagina_${i + 1}${sufixo}.pdf`,
                            nomeExtraido: nomeExtraidoTexto, cpfExtraido: null, tipo: sessao.bucket, mes, ano: new Date().getFullYear()
                        });
                        totalPendentes++;
                        continue;
                    }
                    let cpfExtraidoComprovante = null;
                    try {
                        const resultado = await processarESalvarNaFila(gemini, supabaseAdmin, {
                            fileBuffer: metade.buffer, mediaType: 'application/pdf',
                            caminho: `${pastaUpload}/pagina_${i + 1}${sufixo}.pdf`, bucket: sessao.bucket
                        });
                        if (resultado.sucesso) {
                            const dados = resultado.dados;
                            const nomeExtraido = dados.nome_funcionario || dados.funcionario || dados.nome || null;
                            cpfExtraidoComprovante = dados.cpf || null;
                            if (nomeExtraido) {
                                const nomeNormalizado = normalizarTexto(nomeExtraido);
                                const usuarioMatch = usuarios.find(u => {
                                    const n = normalizarTexto(u.user_metadata?.full_name || '');
                                    return n && nomeNormalizado.includes(n);
                                });
                                const nomeFinal = usuarioMatch ? normalizarTexto(usuarioMatch.user_metadata?.full_name) : nomeNormalizado;
                                const mesRef = dados.competencia || dados.periodo || mes ||
                                    new Date().toLocaleString('pt-BR', { month: 'long' }).toLowerCase();
                                const nomeCompleto = `${nomeFinal} ${mesRef}${sufixo}.pdf`;
                                const caminhoIA = `${pastaUpload}/${nomeCompleto}`;
                                const { error: upErr } = await supabaseAdmin.storage
                                    .from(sessao.bucket).upload(caminhoIA, metade.buffer, { contentType: 'application/pdf', upsert: true });
                                if (!upErr) {
                                    console.log(`SALVO (IA): ${sessao.bucket}/${caminhoIA} | Confiança: ${resultado.confianca?.confianca_geral}%`);
                                    salvouAlgum = true;
                                    continue;
                                }
                            }
                        }
                    } catch (aiErr) {
                        console.error(`Página ${i + 1}${sufixo} erro IA:`, aiErr.message);
                    }
                    await salvarDocumentoPendente({
                        buffer: metade.buffer, nomeArquivo: `pagina_${i + 1}${sufixo}.pdf`,
                        nomeExtraido: null, cpfExtraido: cpfExtraidoComprovante, tipo: sessao.bucket, mes: null, ano: new Date().getFullYear()
                    });
                    totalPendentes++;
                }
            }
        }

        if (!salvouAlgum && totalPendentes > 0) {
            return res.json({
                sucesso: true, status_email: 'nao_enviado',
                pendentes: totalPendentes, aviso: 'Documentos enviados para pendentes.'
            });
        }
        if (!salvouAlgum) return res.status(400).json({ erro: "Nenhum arquivo foi salvo." });

        res.json({ sucesso: true, status_email: 'nao_enviado', pendentes: totalPendentes });
    } catch (err) {
        console.error("ERRO:", err);
        res.status(500).json({ erro: err.message });
    }
});

// =============================
// PIPELINE DE E-MAIL
// =============================
async function processarDocumentosEmail(forcar) {
    if (!forcar) {
        const agora = new Date();
        const dia = agora.getDate();
        if (dia < 1 || dia > 5) {
            console.log(`Email fetcher: dia ${dia} fora da janela (1-5), ignorando.`);
            return [];
        }
    }
    console.log('Email fetcher: buscando documentos...');
    const docs = await buscarDocumentos();
    const criados = [];
    for (const doc of docs) {
        try {
            await salvarDocumentoPendente({
                buffer: doc.buffer,
                nomeArquivo: doc.filename,
                nomeExtraido: null, cpfExtraido: null,
                tipo: 'contracheques', mes: String(doc.mes), ano: doc.ano
            });
            criados.push(doc.filename);
        } catch (e) {
            console.error(`Email fetcher: erro ao salvar ${doc.filename}:`, e.message);
        }
    }
    if (criados.length > 0) {
        console.log(`Email fetcher: ${criados.length} documentos salvos como pendentes:`, criados.join(', '));
    } else {
        console.log('Email fetcher: nenhum documento novo encontrado.');
    }
    return criados;
}

app.post('/verificar-email', async (req, res) => {
    try {
        const admin = await validarAdmin(req, res);
        if (!admin) return;
        const criados = await processarDocumentosEmail(true);
        res.json({ sucesso: true, documentos_criados: criados });
    } catch (err) {
        res.status(500).json({ erro: err.message });
    }
});

app.post('/verificar-solicitacoes', async (req, res) => {
    try {
        const admin = await validarAdmin(req, res);
        if (!admin) return;
        await verificarSolicitacoesPendentes();
        res.json({ sucesso: true });
    } catch (err) {
        res.status(500).json({ erro: err.message });
    }
});

// Executa no startup se estiver entre dia 1-5
const diaAtual = new Date().getDate();
async function verificarSolicitacoesPendentes() {
    try {
        const seteDiasAtras = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
        const { data, error } = await supabaseAdmin
            .from('solicitacoes_contracheques')
            .select('id, criado_em')
            .eq('status', 'pendente')
            .lt('criado_em', seteDiasAtras);
        if (error) { console.error('Erro ao verificar solicitações:', error.message); return; }
        if (!data || data.length === 0) return;
        const baseUrl = process.env.APP_URL || 'http://localhost:3000';
        const link = baseUrl + '/admin.html?secao=solicitacoes';
        await enviarEmail({
            from: 'Portal Kidverte <nao-responda@kidverte.com.br>',
            to: process.env.EMAIL_DESTINO_CONTRACHEQUES || 'financeiro@kidverte.com.br',
            subject: 'Atenção — Solicitações pendentes',
            html: `<h3>Atenção, ainda existem solicitações não resolvidas</h3>
                   <p><strong>Total:</strong> ${data.length} solicitação(ões) pendente(s) há mais de 7 dias.</p>
                   <p><a href="${link}" style="display:inline-block;padding:10px 20px;background:#007bff;color:#fff;text-decoration:none;border-radius:6px;">Resolver solicitações pendentes</a></p>
                   <p style="font-size:12px;color:#6b7280;">Após o login, você será direcionado automaticamente para a página de solicitações.</p>`
        });
        console.log(`EMAIL SOLICITAÇÕES PENDENTES — ${data.length} solicitação(ões)`);
    } catch (e) {
        console.error('Erro verificarSolicitacoesPendentes:', e.message);
    }
}

if (diaAtual >= 1 && diaAtual <= 5) {
    setTimeout(() => {
        processarDocumentosEmail().catch(e => console.error('Email fetcher startup:', e.message));
    }, 5000);
    setInterval(() => {
        if (new Date().getDate() >= 1 && new Date().getDate() <= 5) {
            processarDocumentosEmail().catch(e => console.error('Email fetcher interval:', e.message));
        }
    }, 6 * 60 * 60 * 1000);
}

// Verifica solicitações pendentes a cada 6 horas (todos os dias)
setTimeout(() => {
    verificarSolicitacoesPendentes().catch(e => console.error('Solic pendentes startup:', e.message));
}, 10000);
setInterval(() => {
    verificarSolicitacoesPendentes().catch(e => console.error('Solic pendentes interval:', e.message));
}, 6 * 60 * 60 * 1000);

// =============================
// ROTAS: PENDENTES
// =============================
app.get('/pendentes', async (req, res) => {
    try {
        const admin = await validarAdmin(req, res);
        if (!admin) return;
        const { data, error } = await supabaseAdmin
            .from('documentos_pendentes')
            .select('*')
            .is('vinculado_em', null)
            .order('criado_em', { ascending: false });
        if (error) return res.status(500).json({ erro: error.message });
        res.json(data || []);
    } catch (err) {
        res.status(500).json({ erro: err.message });
    }
});

app.post('/pendentes/:id/vincular', async (req, res) => {
    try {
        const admin = await validarAdmin(req, res);
        if (!admin) return;
        const { id } = req.params;
        const { user_id, tipo, mes_referencia } = req.body;
        if (!user_id) return res.status(400).json({ erro: 'user_id é obrigatório' });

        const { data: pendente, error: buscaErr } = await supabaseAdmin
            .from('documentos_pendentes')
            .select('*')
            .eq('id', id)
            .single();
        if (buscaErr || !pendente) return res.status(404).json({ erro: 'Pendente não encontrado' });
        if (pendente.vinculado_em) return res.status(400).json({ erro: 'Já vinculado' });

        const bucketMap = { contracheque: 'contracheques', 'folha-ponto': 'folhas-ponto', comprovante: 'comprovantes' };
        const bucketDestino = bucketMap[tipo] || pendente.tipo_detectado || 'contracheques';

        const { data: userData } = await supabaseAdmin.auth.admin.getUserById(user_id);
        const nomeUsuario = userData?.user?.user_metadata?.full_name || userData?.user?.email || 'usuario';
        const nomeArquivo = `${nomeUsuario} ${mes_referencia || pendente.mes_detectado || 'sem-mes'}.pdf`;
        const pastaUpload = gerarTimestamp();
        const caminhoDestino = `${pastaUpload}/${nomeArquivo}`;

        const { data: fileData, error: dlErr } = await supabaseAdmin.storage
            .from('pendentes').download(pendente.caminho);
        if (dlErr) return res.status(500).json({ erro: 'Erro ao baixar arquivo pendente' });

        const buffer = Buffer.from(await fileData.arrayBuffer());

        const { error: upErr } = await supabaseAdmin.storage
            .from(bucketDestino).upload(caminhoDestino, buffer, { contentType: 'application/pdf', upsert: true });
        if (upErr) return res.status(500).json({ erro: upErr.message });

        const { data: usuarios } = await supabaseAdmin.auth.admin.listUsers();
        const usuariosList = usuarios?.users || [];

        let statusEmail = 'smtp_nao_configurado';
        if (smtpConfigurado()) {
            try {
                await enviarEmail({
                    from: 'Portal Kidverte <nao-responda@kidverte.com.br>',
                    to: userData?.user?.email || process.env.EMAIL_DESTINO_CONTRACHEQUES || 'financeiro@kidverte.com.br',
                    subject: `[Kidverte] Documento disponível — ${nomeArquivo}`,
                    html: `<h3>Documento vinculado</h3><p>${nomeArquivo} disponível no portal.</p>`,
                    attachments: [{ filename: nomeArquivo, content: buffer }]
                });
                statusEmail = 'enviado';
            } catch { statusEmail = 'erro_envio'; }
        }

        const { error: upDbErr } = await supabaseAdmin
            .from('documentos_pendentes')
            .update({ vinculado_em: new Date().toISOString(), user_id, bucket_destino: bucketDestino, caminho_destino: caminhoDestino, status_email: statusEmail })
            .eq('id', id);
        if (upDbErr) console.error('Erro ao atualizar pendente:', upDbErr.message);

        res.json({ sucesso: true, status_email: statusEmail });
    } catch (err) {
        res.status(500).json({ erro: err.message });
    }
});

app.delete('/pendentes/:id', async (req, res) => {
    try {
        const admin = await validarAdmin(req, res);
        if (!admin) return;
        const { id } = req.params;
        const { data: pendente, error: buscaErr } = await supabaseAdmin
            .from('documentos_pendentes')
            .select('*')
            .eq('id', id)
            .single();
        if (buscaErr || !pendente) return res.status(404).json({ erro: 'Pendente não encontrado' });
        if (pendente.caminho) {
            await supabaseAdmin.storage.from('pendentes').remove([pendente.caminho]);
        }
        const { error: delErr } = await supabaseAdmin
            .from('documentos_pendentes')
            .delete()
            .eq('id', id);
        if (delErr) return res.status(500).json({ erro: delErr.message });
        res.json({ sucesso: true });
    } catch (err) {
        res.status(500).json({ erro: err.message });
    }
});

app.get('/pendentes/:id/arquivo', async (req, res) => {
    try {
        const token = req.query.token || req.headers.authorization?.replace('Bearer ', '');
        if (!token) return res.status(401).json({ erro: 'Token não fornecido' });
        const { data: { user }, error: userErr } = await supabaseAdmin.auth.getUser(token);
        if (userErr || !user) return res.status(401).json({ erro: 'Token inválido' });
        if (user.user_metadata?.tipo !== 'admin') return res.status(403).json({ erro: 'Acesso negado' });
        const { id } = req.params;
        const { data: pendente, error } = await supabaseAdmin
            .from('documentos_pendentes')
            .select('caminho')
            .eq('id', id)
            .single();
        if (error || !pendente?.caminho) return res.status(404).json({ erro: 'Arquivo não encontrado' });
        const { data, error: dlErr } = await supabaseAdmin.storage
            .from('pendentes').download(pendente.caminho);
        if (dlErr || !data) return res.status(500).json({ erro: 'Erro ao baixar arquivo' });
        const buffer = Buffer.from(await data.arrayBuffer());
        res.setHeader('Content-Type', 'application/pdf');
        res.setHeader('Content-Disposition', `inline; filename="${encodeURIComponent(path.basename(pendente.caminho))}"`);
        res.send(buffer);
    } catch (err) {
        res.status(500).json({ erro: err.message });
    }
});

// =============================
// ROTA: PROCESSAR DOCUMENTO AVULSO COM IA
// =============================
app.post('/processar-documento', upload.single('arquivo'), async (req, res) => {
    try {
        const admin = await validarAdmin(req, res);
        if (!admin) return;

        if (!req.file) return res.status(400).json({ erro: 'Arquivo não enviado' });

        const mediaType = detectarMediaType(req.file.originalname);
        const bucket = req.body.bucket || 'contracheques';
        const pastaUpload = gerarTimestamp();
        const nomeArquivo = req.file.originalname || `doc_${Date.now()}.pdf`;
        const caminho = `${pastaUpload}/${nomeArquivo}`;

        await supabaseAdmin.storage.from(bucket).upload(caminho, req.file.buffer, {
            contentType: mediaType, upsert: true
        });

        const resultado = await processarESalvarNaFila(gemini, supabaseAdmin, {
            fileBuffer: req.file.buffer, mediaType, caminho, bucket
        });

        res.json({ ...resultado, caminho, bucket });
    } catch (err) {
        console.error("ERRO /processar-documento:", err);
        res.status(500).json({ erro: err.message });
    }
});

// =============================
// ROTAS: FILA DE REVISÃO
// =============================
app.get('/fila-revisao', async (req, res) => {
    try {
        const admin = await validarAdmin(req, res);
        if (!admin) return;
        const itens = await listarFila(supabaseAdmin, req.query.status || 'pendente');
        res.json(itens);
    } catch (err) {
        res.status(500).json({ erro: err.message });
    }
});

app.put('/fila-revisao/:id', async (req, res) => {
    try {
        const admin = await validarAdmin(req, res);
        if (!admin) return;
        await resolverItem(supabaseAdmin, req.params.id, req.body.dados_corrigidos);
        res.json({ sucesso: true });
    } catch (err) {
        res.status(500).json({ erro: err.message });
    }
});

// =============================
// ROTA: CADASTRO
// =============================
app.post('/register', async (req, res) => {
    const { email, senha, nome, cpf, tipo, empresa } = req.body;
    const metadata = { full_name: nome, cpf, tipo };
    if (empresa) metadata.empresa = empresa;
    const { error } = await supabaseAdmin.auth.admin.createUser({
        email, password: senha, email_confirm: true,
        user_metadata: metadata
    });
    if (error) return res.status(400).json({ erro: error.message });
    res.json({ sucesso: true });
});

// =============================
// ROTA: RESOLVER LOGIN POR EMAIL OU CPF
// =============================
app.post('/resolve-login', async (req, res) => {
    try {
        const { login } = req.body;
        if (!login) return res.status(400).json({ erro: "Login não informado" });

        if (String(login).includes("@")) return res.json({ email: String(login).trim() });

        const cpf = cpfLimpo(login);
        if (cpf.length !== 11) return res.status(400).json({ erro: "CPF inválido" });

        const { data, error } = await supabaseAdmin.auth.admin.listUsers();
        if (error) return res.status(400).json({ erro: error.message });

        const usuario = data.users.find(user => cpfLimpo(user.user_metadata?.cpf || "") === cpf);
        if (!usuario?.email) return res.status(404).json({ erro: "CPF não encontrado" });

        res.json({ email: usuario.email });
    } catch (err) {
        res.status(500).json({ erro: err.message });
    }
});

// =============================
// ROTA: DOCUMENTOS DO USUÁRIO
// =============================
app.get('/documentos', async (req, res) => {
    try {
        const user = await validarUsuario(req, res);
        if (!user) return;

        let tipo = 'contracheque';
        if (req.query.tipo === 'folha-ponto') tipo = 'folha-ponto';
        if (req.query.tipo === 'comprovante') tipo = 'comprovante';

        const documentos = await listarDocumentosUsuario(user, tipo);
        res.json(documentos);
    } catch (err) {
        res.status(500).json({ erro: err.message });
    }
});

// =============================
// ROTA: DOWNLOAD DE DOCUMENTO
// =============================
app.get('/download-documento', async (req, res) => {
    try {
        const user = await validarUsuario(req, res);
        if (!user) return;

        const bucket = req.query.bucket;
        const caminho = req.query.caminho;

        if (!['contracheques', 'folhas-ponto', 'atestados', 'comprovantes'].includes(bucket) || !caminho) {
            return res.status(400).json({ erro: "Documento inválido" });
        }

        if (bucket === 'contracheques' || bucket === 'folhas-ponto') {
            const tipo = bucket === 'folhas-ponto' ? 'folha-ponto' : 'contracheque';
            const permitidos = await listarDocumentosUsuario(user, tipo);
            const permitido = permitidos.some(doc => doc.bucket === bucket && doc.caminho === caminho);
            if (!permitido) return res.status(403).json({ erro: "Documento não liberado" });
        }

        if (bucket === 'atestados' && user.user_metadata?.tipo !== 'admin') {
            return res.status(403).json({ erro: "Acesso negado" });
        }

        const { data, error } = await supabaseAdmin.storage.from(bucket).download(caminho);
        if (error) return res.status(400).json({ erro: error.message });

        const buffer = Buffer.from(await data.arrayBuffer());
        res.setHeader('Content-Type', data.type || 'application/octet-stream');
        res.setHeader('Content-Disposition', `attachment; filename="${encodeURIComponent(path.basename(caminho))}"`);
        res.send(buffer);
    } catch (err) {
        res.status(500).json({ erro: err.message });
    }
});

// =============================
// ROTAS: SOLICITAÇÕES DE CONTRACHEQUES
// =============================
app.post('/solicitacoes-contracheques', async (req, res) => {
    try {
        const user = await validarUsuario(req, res);
        if (!user) return;

        const { referencia, motivo } = req.body;
        const { error } = await supabaseAdmin.from('solicitacoes_contracheques').insert({
            user_id: user.id,
            nome_usuario: user.user_metadata?.full_name || "",
            referencia: referencia || "",
            motivo: motivo || "",
            status: 'pendente'
        });

        if (error) return res.status(400).json({ erro: error.message });
        res.json({ sucesso: true });
    } catch (err) {
        res.status(500).json({ erro: err.message });
    }
});

app.get('/solicitacoes-contracheques', async (req, res) => {
    try {
        const user = await validarUsuario(req, res);
        if (!user) return;

        const trintaDiasAtras = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();

        let query = supabaseAdmin.from('solicitacoes_contracheques')
            .select('*')
            .or(`status.eq.pendente,data_resposta.gte.${trintaDiasAtras}`)
            .order('criado_em', { ascending: false });
        if (user.user_metadata?.tipo !== 'admin') query = query.eq('user_id', user.id);

        const { data, error } = await query;
        if (error) return res.status(400).json({ erro: error.message });
        res.json(data || []);
    } catch (err) {
        res.status(500).json({ erro: err.message });
    }
});

app.put('/solicitacoes-contracheques/:id', async (req, res) => {
    try {
        const user = await validarUsuario(req, res);
        if (!user) return;

        if (user.user_metadata?.tipo !== 'admin') return res.status(403).json({ erro: 'Acesso negado' });

        const { status, resposta_financeiro } = req.body;
        const { data, error } = await supabaseAdmin
            .from('solicitacoes_contracheques')
            .update({ status, resposta_financeiro, data_resposta: new Date() })
            .eq('id', req.params.id).select();

        if (error) return res.status(400).json({ erro: error.message });
        res.json({ sucesso: true, data });
    } catch (err) {
        res.status(500).json({ erro: err.message });
    }
});

// =============================
// ROTAS: ATESTADOS
// =============================
app.get('/atestados', async (req, res) => {
    try {
        const admin = await validarAdmin(req, res);
        if (!admin) return;

        const baixados = req.query.baixados === 'true';
        const { data, error } = await supabaseAdmin
            .from('atestados').select('*').eq('baixado', baixados)
            .order('criado_em', { ascending: false }).limit(100);

        if (error) return res.status(400).json({ erro: error.message });
        res.json(data || []);
    } catch (err) {
        res.status(500).json({ erro: err.message });
    }
});

app.get('/atestados/download/:id', async (req, res) => {
    try {
        const admin = await validarAdmin(req, res);
        if (!admin) return;

        const { data: atestado, error: erroBusca } = await supabaseAdmin
            .from('atestados').select('*').eq('id', req.params.id).single();

        if (erroBusca || !atestado) return res.status(404).json({ erro: 'Atestado não encontrado.' });

        const caminho = atestado.caminho || atestado.arquivo;
        if (!caminho) return res.status(400).json({ erro: 'Caminho do arquivo não encontrado.' });

        const { data: fileData, error: erroDownload } = await supabaseAdmin.storage
            .from('atestados').download(caminho);

        if (erroDownload || !fileData) return res.status(500).json({ erro: 'Erro ao acessar arquivo.' });

        await supabaseAdmin.from('atestados')
            .update({ baixado: true, baixado_em: new Date().toISOString() }).eq('id', req.params.id);

        const buffer = Buffer.from(await fileData.arrayBuffer());
        res.setHeader('Content-Type', 'application/octet-stream');
        res.setHeader('Content-Disposition', `attachment; filename="${atestado.nome_arquivo || caminho.split('/').pop()}"`);
        res.send(buffer);
    } catch (err) {
        res.status(500).json({ erro: err.message });
    }
});

app.post('/atestados', upload.single('arquivo'), async (req, res) => {
    try {
        const user = await validarUsuario(req, res);
        if (!user) return;

        if (!req.file) return res.status(400).json({ erro: 'Arquivo não enviado' });

        const pasta = `${user.id}/${gerarTimestamp()}`;
        const nomeArquivo = req.file.originalname || 'atestado.pdf';
        const caminho = `${pasta}/${nomeArquivo}`;

        const { error: erroUpload } = await supabaseAdmin.storage.from('atestados')
            .upload(caminho, req.file.buffer, { contentType: req.file.mimetype || 'application/octet-stream', upsert: true });

        if (erroUpload) return res.status(400).json({ erro: erroUpload.message });

        const { data: atestadoData, error: erroInsert } = await supabaseAdmin.from('atestados').insert({
            user_id: user.id,
            nome_usuario: user.user_metadata?.full_name || "",
            email_usuario: user.email || "",
            arquivo: caminho,
            nome_arquivo: nomeArquivo,
            email_financeiro: 'financeiro@kidverte.com.br',
            status_email: 'pendente_envio'
        }).select();

        if (erroInsert) return res.status(400).json({ erro: erroInsert.message });

        const atestado = atestadoData?.[0];
        let statusEmail = 'pendente_envio';

        if (!smtpConfigurado()) {
            statusEmail = 'smtp_nao_configurado';
        } else {
            try {
                await enviarEmail({
                    from: 'Portal Kidverte <nao-responda@kidverte.com.br>',
                    to: 'financeiro@kidverte.com.br',
                    replyTo: user.email,
                    subject: 'Novo atestado enviado',
                    html: `<h3>Novo atestado recebido</h3><p><strong>Funcionário:</strong> ${user.user_metadata?.full_name}</p><p><strong>Email:</strong> ${user.email}</p>`,
                    attachments: [{ filename: nomeArquivo, content: req.file.buffer }]
                });
                statusEmail = 'enviado';
            } catch (emailErr) {
                console.error("SMTP ERROR:", emailErr.message);
                statusEmail = 'erro_envio';
            }
        }

        if (atestado?.id) {
            await supabaseAdmin.from('atestados').update({ status_email: statusEmail }).eq('id', atestado.id);
        }

        res.json({ sucesso: true, status_email: statusEmail });
    } catch (err) {
        res.status(500).json({ erro: err.message });
    }
});

// =============================
// ROTAS: COMPROVANTES
// =============================
app.get('/comprovantes', async (req, res) => {
    try {
        const user = await validarUsuario(req, res);
        if (!user) return;
        const documentos = await listarDocumentosUsuario(user, 'comprovante');
        res.json(documentos);
    } catch (err) {
        res.status(500).json({ erro: err.message });
    }
});

// =============================
// ROTAS: CONFIRMAÇÕES DE CONTRACHEQUES
// =============================
app.post('/confirmacoes', async (req, res) => {
    try {
        const user = await validarUsuario(req, res);
        if (!user) return;

        const { arquivo } = req.body;
        if (!arquivo) return res.status(400).json({ erro: "Arquivo não informado" });

        const { data: existente } = await supabaseAdmin.from('confirmacoes_contracheque').select('*')
            .eq('user_id', user.id).eq('arquivo', arquivo).limit(1);

        if (existente && existente.length > 0) return res.json({ sucesso: true, existente: true });

        const { error: erroInsert } = await supabaseAdmin.from('confirmacoes_contracheque').insert({
            user_id: user.id,
            nome_usuario: user.user_metadata?.full_name || "",
            arquivo, confirmado: true, visualizada: false
        });

        if (erroInsert) return res.status(400).json({ erro: erroInsert.message });
        res.json({ sucesso: true, existente: false });
    } catch (err) {
        res.status(500).json({ erro: err.message });
    }
});

app.post('/confirmacoes/marcar-vistas', async (req, res) => {
    try {
        const admin = await validarAdmin(req, res);
        if (!admin) return;

        const { error } = await supabaseAdmin
            .from('confirmacoes_contracheque')
            .update({ visualizada: true })
            .eq('visualizada', false);

        if (error) return res.status(400).json({ erro: error.message });
        res.json({ sucesso: true });
    } catch (err) {
        res.status(500).json({ erro: err.message });
    }
});

app.get('/confirmacoes/status', async (req, res) => {
    try {
        const user = await validarUsuario(req, res);
        if (!user) return;

        const arquivo = req.query.arquivo;
        if (!arquivo) return res.status(400).json({ erro: "Arquivo não informado" });

        const { data, error } = await supabaseAdmin.from('confirmacoes_contracheque').select('*')
            .eq('user_id', user.id).eq('arquivo', arquivo).limit(1);

        if (error) return res.status(400).json({ erro: error.message });
        res.json({ confirmado: !!(data && data.length > 0) });
    } catch (err) {
        res.status(500).json({ erro: err.message });
    }
});

app.get('/confirmacoes', async (req, res) => {
    try {
        const admin = await validarAdmin(req, res);
        if (!admin) return;

        const { data, error } = await supabaseAdmin.from('confirmacoes_contracheque').select('*').limit(100);
        if (error) return res.status(400).json({ erro: error.message });

        const confirmacoesOrdenadas = (data || []).sort((a, b) =>
            new Date(b.criado_em || b.data || b.data_confirmacao || 0) -
            new Date(a.criado_em || a.data || a.data_confirmacao || 0)
        );

        const vistos = new Set();
        let confirmacoes = [];
        for (const c of confirmacoesOrdenadas) {
            const chave = `${c.user_id || ""}::${c.arquivo || ""}`;
            if (vistos.has(chave)) continue;
            vistos.add(chave);
            confirmacoes.push(c);
        }

        if (req.query.periodo === 'recentes') {
            const limite = new Date();
            limite.setDate(limite.getDate() - 30);
            confirmacoes = confirmacoes.filter(c =>
                new Date(c.criado_em || c.data || c.data_confirmacao || 0) >= limite
            );
        }

        res.json(confirmacoes);
    } catch (err) {
        res.status(500).json({ erro: err.message });
    }
});

// =============================
// ROTAS: USUÁRIOS
// =============================
app.get('/users', async (req, res) => {
    try {
        const admin = await validarAdmin(req, res);
        if (!admin) return;
        const { data, error } = await supabaseAdmin.auth.admin.listUsers();
        if (error) return res.status(400).json({ erro: error.message });
        res.json(data.users);
    } catch (err) {
        res.status(500).json({ erro: err.message });
    }
});

app.delete('/users/:id', async (req, res) => {
    try {
        const admin = await validarAdmin(req, res);
        if (!admin) return;
        const { error } = await supabaseAdmin.auth.admin.deleteUser(req.params.id);
        if (error) return res.status(400).json({ erro: error.message });
        res.json({ sucesso: true });
    } catch (err) {
        res.status(500).json({ erro: err.message });
    }
});

app.put('/users/:id', async (req, res) => {
    try {
        const admin = await validarAdmin(req, res);
        if (!admin) return;

        const { email, senha, empresa, tipo } = req.body;
        const dadosAtualizacao = {};
        if (email) dadosAtualizacao.email = email;
        if (senha) dadosAtualizacao.password = senha;

        // atualiza user_metadata se empresa ou tipo foram enviados
        if (empresa !== undefined || tipo !== undefined) {
            const { data: userData } = await supabaseAdmin.auth.admin.getUserById(req.params.id);
            if (userData?.user) {
                const meta = { ...userData.user.user_metadata };
                if (empresa !== undefined) meta.empresa = empresa;
                if (tipo !== undefined) meta.tipo = tipo;
                dadosAtualizacao.user_metadata = meta;
            }
        }

        const { data, error } = await supabaseAdmin.auth.admin.updateUserById(req.params.id, dadosAtualizacao);
        if (error) return res.status(400).json({ erro: error.message });
        res.json({ sucesso: true, user: data });
    } catch (err) {
        res.status(500).json({ erro: err.message });
    }
});

// =============================
// EMPRESAS
// =============================
app.get('/empresas', async (req, res) => {
    try {
        const admin = await validarAdmin(req, res);
        if (!admin) return;
        const { data, error } = await supabaseAdmin.from('empresas').select('*').order('razao_social');
        if (error) return res.status(500).json({ erro: error.message });
        res.json(data || []);
    } catch (err) {
        res.status(500).json({ erro: err.message });
    }
});

app.post('/empresas', async (req, res) => {
    try {
        const admin = await validarAdmin(req, res);
        if (!admin) return;
        const { razao_social, cnpj } = req.body;
        if (!razao_social || !cnpj) return res.status(400).json({ erro: 'Razão social e CNPJ são obrigatórios' });
        const { data, error } = await supabaseAdmin.from('empresas').insert({
            razao_social, cnpj, criado_em: new Date().toISOString()
        }).select().single();
        if (error) return res.status(500).json({ erro: error.message });
        res.json(data);
    } catch (err) {
        res.status(500).json({ erro: err.message });
    }
});

// =============================
// PROFILE / MEUS DADOS
// =============================
app.put('/users/:id/dados', async (req, res) => {
    try {
        const user = await validarUsuario(req, res);
        if (!user || user.id !== req.params.id) return res.status(403).json({ erro: 'Acesso negado' });

        const { endereco, empresa } = req.body;
        const metadata = {};
        if (endereco !== undefined) metadata.endereco = endereco;
        if (empresa !== undefined) metadata.empresa = empresa;

        const { data, error } = await supabaseAdmin.auth.admin.updateUserById(req.params.id, {
            user_metadata: { ...user.user_metadata, ...metadata }
        });
        if (error) return res.status(400).json({ erro: error.message });
        res.json({ sucesso: true, user_metadata: data.user.user_metadata });
    } catch (err) {
        res.status(500).json({ erro: err.message });
    }
});

app.post('/users/:id/foto', upload.single('foto'), async (req, res) => {
    try {
        const user = await validarUsuario(req, res);
        if (!user || user.id !== req.params.id) return res.status(403).json({ erro: 'Acesso negado' });

        const file = req.file;
        if (!file) return res.status(400).json({ erro: 'Nenhuma foto enviada' });

        const ext = path.extname(file.originalname) || '.jpg';
        const nomeArquivo = `perfil_${req.params.id}${ext}`;

        const { error: upErr } = await supabaseAdmin.storage
            .from('perfis')
            .upload(nomeArquivo, file.buffer, { contentType: file.mimetype, upsert: true });
        if (upErr) return res.status(500).json({ erro: upErr.message });

        const { data: pubData } = supabaseAdmin.storage.from('perfis').getPublicUrl(nomeArquivo);
        const url = pubData?.publicUrl || `https://uatryxvylqwslnaxggjk.supabase.co/storage/v1/object/public/perfis/${nomeArquivo}`;

        const { error: metaErr } = await supabaseAdmin.auth.admin.updateUserById(req.params.id, {
            user_metadata: { ...user.user_metadata, foto_url: url }
        });
        if (metaErr) console.error('Erro ao salvar foto_url:', metaErr.message);

        res.json({ sucesso: true, url });
    } catch (err) {
        res.status(500).json({ erro: err.message });
    }
});

app.get('/me', async (req, res) => {
    try {
        const authHeader = req.headers.authorization;
        if (!authHeader) return res.status(401).json({ erro: 'Token não fornecido' });
        const token = authHeader.replace('Bearer ', '');
        const { data: { user }, error } = await supabaseAdmin.auth.getUser(token);
        if (error || !user) return res.status(401).json({ erro: 'Usuário não encontrado' });
        // busca dados mais recentes no Admin API
        const { data: userData } = await supabaseAdmin.auth.admin.getUserById(user.id);
        res.json(userData?.user || user);
    } catch (err) {
        res.status(500).json({ erro: err.message });
    }
});

// =============================
// START
// =============================
const PORT = process.env.PORT || 3000;

app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'login.html'));
});

app.listen(PORT, () => {
    console.log(`Servidor rodando na porta ${PORT}`);
});
