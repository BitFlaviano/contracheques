const express = require('express');
const cors = require('cors');
const multer = require('multer');
const { createClient } = require('@supabase/supabase-js');
const WebSocket = require('ws');
const { PDFDocument } = require('pdf-lib');
const pdfParse = require('pdf-parse');
//const pdf = require('pdf-parse');
//const pdfParse = require('pdf-parse/lib/pdf-parse');
const path = require('path');
const { Resend } = require('resend');


const app = express();
app.use(express.json());
app.use(cors());
app.use(express.static(path.join(__dirname, 'public')));

// =============================
// CONFIGURAÇÕES
// =============================
const SUPABASE_URL = 'https://uatryxvylqwslnaxggjk.supabase.co';
const SUPABASE_SERVICE_ROLE = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InVhdHJ5eHZ5bHF3c2xuYXhnZ2prIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3NzAwODk5OSwiZXhwIjoyMDkyNTg0OTk5fQ.Sy3jX2ZbRFIHR2GI_8TrOE4uxMQz__K3MqK-LClsMwg';
const supabaseAdmin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE, {
    realtime: { transport: WebSocket }
});

const upload = multer({ storage: multer.memoryStorage() });

// =============================
// CONFIGURAÇÃO RESEND (API HTTP)
// =============================
const resend = new Resend(process.env.RESEND_API_KEY);

function smtpConfigurado() {
    return !!process.env.RESEND_API_KEY;
}

async function enviarEmail({ from, to, replyTo, subject, html, attachments }) {
    const payload = { from, to, subject, html };
    if (replyTo) payload.replyTo = replyTo;
    if (attachments && attachments.length > 0) {
        payload.attachments = attachments.map(a => ({
            filename: a.filename,
            content: a.content  // Buffer
        }));
    }
    const { data, error } = await resend.emails.send(payload);
    if (error) {
        const err = new Error(error.message || 'Erro ao enviar email via Resend');
        err.resendError = error;
        throw err;
    }
    return data;
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

async function validarUsuario(req, res) {
    const authHeader = req.headers.authorization || "";
    const token = authHeader.startsWith("Bearer ")
        ? authHeader.slice(7)
        : null;

    if (!token) {
        res.status(403).json({ erro: "Acesso negado" });
        return null;
    }

    const { data, error } = await supabaseAdmin.auth.getUser(token);

    if (error || !data.user) {
        res.status(403).json({ erro: "Acesso negado" });
        return null;
    }

    return data.user;
}

// =============================
// FUNÇÃO: GERAR TIMESTAMP
// =============================
function gerarTimestamp() {
    const agora = new Date();
    return `${agora.getFullYear()}${String(agora.getMonth() + 1).padStart(2, '0')}${String(agora.getDate()).padStart(2, '0')}_${String(agora.getHours()).padStart(2, '0')}${String(agora.getMinutes()).padStart(2, '0')}`;
}

// =============================
// FUNÇÃO: IDENTIFICAR USUÁRIO
// =============================
function identificarUsuario(texto, usuarios) {
    if (!texto) return null;

    const textoNormalizado = texto
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "")
        .toUpperCase();

    for (let user of usuarios) {
        const nomeUser = user.user_metadata?.full_name;
        if (!nomeUser) continue;

        const nomeNormalizado = nomeUser
            .normalize("NFD")
            .replace(/[\u0300-\u036f]/g, "")
            .toUpperCase();

        if (textoNormalizado.includes(nomeNormalizado)) {
            return nomeUser.toUpperCase(); // ← agora com espaço
        }
    }

    return null;
}

// =============================
// FUNÇÃO: EXTRAIR MÊS
// =============================
function extrairMes(texto) {
    const meses = [
        'janeiro','fevereiro','marco','abril','maio','junho',
        'julho','agosto','setembro','outubro','novembro','dezembro'
    ];

    const textoLower = texto.toLowerCase();

    for (let mes of meses) {
        if (textoLower.includes(mes)) return mes;
    }

    return "mes_desconhecido";
}

function normalizarTexto(texto = "") {
    return texto
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "")
        .toUpperCase()
        .trim();
}

function cpfLimpo(cpf = "") {
    return String(cpf).replace(/\D/g, "");
}

function dataDaPasta(nomePasta = "") {
    const match = String(nomePasta).match(/^(\d{4})(\d{2})(\d{2})/);

    if (!match) return null;

    const data = new Date(
        Number(match[1]),
        Number(match[2]) - 1,
        Number(match[3])
    );

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

    return data.getFullYear() === hoje.getFullYear() &&
        data.getMonth() === hoje.getMonth();
}

function somarDias(data, dias) {
    const resultado = new Date(data);
    resultado.setDate(resultado.getDate() + dias);
    return resultado;
}

async function garantirBuckets() {
    const buckets = ['contracheques', 'folhas-ponto', 'atestados'];

    for (const bucket of buckets) {
        const { data } = await supabaseAdmin.storage.getBucket(bucket);

        if (!data) {
            await supabaseAdmin.storage.createBucket(bucket, {
                public: false
            });
        }
    }
}

garantirBuckets().catch(err => {
    console.warn("Aviso ao verificar buckets:", err.message);
});

async function processarPdfPorUsuario(req, res, bucket) {
    try {
        const admin = await validarAdmin(req, res);
        if (!admin) return;

        if (!req.file) {
            return res.status(400).json({ erro: "Arquivo não enviado" });
        }

        const pdfBuffer = req.file.buffer;
        const pdfDoc = await PDFDocument.load(pdfBuffer);
        const totalPaginas = pdfDoc.getPageCount();

        const { data: usersData, error: usersError } =
            await supabaseAdmin.auth.admin.listUsers();

        if (usersError) {
            return res.status(500).json({ erro: "Erro ao buscar usuários" });
        }

        const usuarios = usersData.users;
        const pastaUpload = gerarTimestamp();

        let salvouAlgum = false;

        for (let i = 0; i < totalPaginas; i++) {
            const novoPdf = await PDFDocument.create();
            const [pagina] = await novoPdf.copyPages(pdfDoc, [i]);
            novoPdf.addPage(pagina);

            const pdfBytes = await novoPdf.save();
            const dadosPagina = await pdfParse(Buffer.from(pdfBytes));
            const textoPagina = dadosPagina.text;

            const nome = identificarUsuario(textoPagina, usuarios);
            const mes = extrairMes(textoPagina);

            if (!nome) {
                console.log(`Página ${i + 1} sem usuário identificado`);
                continue;
            }

            const nomeArquivo = `${nome} ${mes}.pdf`;
            const caminho = `${pastaUpload}/${nomeArquivo}`;

            const { error } = await supabaseAdmin.storage
                .from(bucket)
                .upload(caminho, pdfBytes, {
                    contentType: 'application/pdf',
                    upsert: true
                });

            if (error) {
                console.log("ERRO STORAGE:", error.message);
            } else {
                console.log("SALVO:", bucket, caminho);
                salvouAlgum = true;
            }
        }

        if (!salvouAlgum) {
            return res.status(400).json({
                erro: "Nenhum arquivo foi salvo."
            });
        }

        // =============================
        // ENVIO DE EMAIL — CONTRACHEQUES
        // =============================
        let statusEmail = 'smtp_nao_configurado';

        if (smtpConfigurado()) {
            try {
                console.log('Resend configurado — enviando email de contracheques...');

                const { data: pastasCheck } = await supabaseAdmin.storage
                    .from(bucket)
                    .list(pastaUpload, { limit: 1000 });

                const anexos = [];
                for (const arq of pastasCheck || []) {
                    const { data: fileData } = await supabaseAdmin.storage
                        .from(bucket)
                        .download(`${pastaUpload}/${arq.name}`);
                    if (fileData) {
                        const arrayBuffer = await fileData.arrayBuffer();
                        anexos.push({
                            filename: arq.name,
                            content: Buffer.from(arrayBuffer)
                        });
                    }
                }

                const totalAnexos = anexos.length;
                const nomesBuckets = { 'contracheques': 'Contracheques', 'folhas-ponto': 'Folhas de Ponto' };
                const tipoBucket = nomesBuckets[bucket] || bucket;

                await enviarEmail({
                    from: 'Portal Kidverte <nao-responda@kidverte.com.br>',
                    to: process.env.EMAIL_DESTINO_CONTRACHEQUES || 'financeiro@kidverte.com.br',
                    subject: `[Kidverte] ${tipoBucket} carregados — ${totalAnexos} arquivo(s)`,
                    html: `
                        <h3>${tipoBucket} carregados com sucesso</h3>
                        <p><strong>Total de arquivos:</strong> ${totalAnexos}</p>
                        <p><strong>Pasta:</strong> ${pastaUpload}</p>
                        <p>Os arquivos estão anexados neste email e disponíveis no portal.</p>
                        <br>
                        <p style="color:#888;font-size:12px">Enviado automaticamente pelo Portal Kidverte</p>
                    `,
                    attachments: anexos
                });

                console.log(`EMAIL CONTRACHEQUES ENVIADO — ${totalAnexos} anexo(s)`);
                statusEmail = 'enviado';

            } catch (emailErr) {
                console.error("================ RESEND ERROR ================");
                console.error("MESSAGE:", emailErr.message);
                if (emailErr.resendError) {
                    console.error("RESEND DETAILS:", JSON.stringify(emailErr.resendError, null, 2));
                }
                console.error("FULL ERROR:", emailErr);
                console.error("===============================================");
                statusEmail = 'erro_envio';
            }
        } else {
            console.warn("RESEND_API_KEY não configurado — email de contracheques NÃO enviado. Defina RESEND_API_KEY no ambiente.");
        }

        res.json({ sucesso: true, status_email: statusEmail });

    } catch (err) {
        console.error("ERRO:", err);
        res.status(500).json({ erro: err.message });
    }
}

async function listarDocumentosUsuario(user, tipo) {
    const bucket = tipo === 'folha-ponto' ? 'folhas-ponto' : 'contracheques';
    const nomeNormalizado = normalizarTexto(user.user_metadata?.full_name || "");
    const resultado = [];

    const { data: pastas, error: erroPastas } = await supabaseAdmin.storage
        .from(bucket)
        .list('', { limit: 1000 });

    if (erroPastas) throw erroPastas;

    let liberarAntigos = false;

    if (tipo === 'contracheque') {
        const { data: solicitacoes } = await supabaseAdmin
            .from('solicitacoes_contracheques')
            .select('*')
            .eq('user_id', user.id)
            .eq('status', 'aprovado');

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
            .from(bucket)
            .list(pasta.name, { limit: 1000 });

        for (const arquivo of arquivos || []) {
            const nomeArquivo = normalizarTexto(arquivo.name);

            if (!nomeArquivo.includes(nomeNormalizado)) continue;

            resultado.push({
                nome: arquivo.name,
                caminho: `${pasta.name}/${arquivo.name}`,
                tipo,
                bucket,
                data_upload: dataPasta?.toISOString() || null
            });
        }
    }

    return resultado.sort((a, b) =>
        new Date(b.data_upload || 0) - new Date(a.data_upload || 0)
    );
}

// =============================
// FUNÇÃO: CADASTRO
// =============================
app.post('/register', async (req, res) => {
    const { email, senha, nome, cpf, tipo } = req.body;

    const { error } = await supabaseAdmin.auth.admin.createUser({
        email,
        password: senha,
        email_confirm: true,
        user_metadata: { full_name: nome, cpf, tipo }
    });

    if (error) return res.status(400).json({ erro: error.message });

    res.json({ sucesso: true });
});

// =============================
// FUNÇÃO: RESOLVER LOGIN POR EMAIL OU CPF
// =============================
app.post('/resolve-login', async (req, res) => {
    try {
        const { login } = req.body;

        if (!login) {
            return res.status(400).json({ erro: "Login não informado" });
        }

        if (String(login).includes("@")) {
            return res.json({ email: String(login).trim() });
        }

        const cpf = cpfLimpo(login);

        if (cpf.length !== 11) {
            return res.status(400).json({ erro: "CPF inválido" });
        }

        const { data, error } = await supabaseAdmin.auth.admin.listUsers();

        if (error) return res.status(400).json({ erro: error.message });

        const usuario = data.users.find(user =>
            cpfLimpo(user.user_metadata?.cpf || "") === cpf
        );

        if (!usuario?.email) {
            return res.status(404).json({ erro: "CPF não encontrado" });
        }

        res.json({ email: usuario.email });

    } catch (err) {
        res.status(500).json({ erro: err.message });
    }
});

// =============================
// FUNÇÃO: LISTAR DOCUMENTOS DO USUÁRIO
// =============================
app.get('/documentos', async (req, res) => {
    try {
        const user = await validarUsuario(req, res);
        if (!user) return;

        const tipo = req.query.tipo === 'folha-ponto'
            ? 'folha-ponto'
            : 'contracheque';

        const documentos = await listarDocumentosUsuario(user, tipo);

        res.json(documentos);

    } catch (err) {
        res.status(500).json({ erro: err.message });
    }
});

app.get('/download-documento', async (req, res) => {
    try {
        const user = await validarUsuario(req, res);
        if (!user) return;

        const bucket = req.query.bucket;
        const caminho = req.query.caminho;

        if (!['contracheques', 'folhas-ponto', 'atestados'].includes(bucket) || !caminho) {
            return res.status(400).json({ erro: "Documento inválido" });
        }

        if (bucket === 'contracheques' || bucket === 'folhas-ponto') {
            const tipo = bucket === 'folhas-ponto' ? 'folha-ponto' : 'contracheque';
            const permitidos = await listarDocumentosUsuario(user, tipo);
            const permitido = permitidos.some(doc =>
                doc.bucket === bucket && doc.caminho === caminho
            );

            if (!permitido) {
                return res.status(403).json({ erro: "Documento não liberado" });
            }
        }

        if (bucket === 'atestados' && user.user_metadata?.tipo !== 'admin') {
            return res.status(403).json({ erro: "Acesso negado" });
        }

        const { data, error } = await supabaseAdmin.storage
            .from(bucket)
            .download(caminho);

        if (error) return res.status(400).json({ erro: error.message });

        const arrayBuffer = await data.arrayBuffer();
        const buffer = Buffer.from(arrayBuffer);

        res.setHeader('Content-Type', data.type || 'application/octet-stream');
        res.setHeader(
            'Content-Disposition',
            `attachment; filename="${encodeURIComponent(path.basename(caminho))}"`
        );
        res.send(buffer);

    } catch (err) {
        res.status(500).json({ erro: err.message });
    }
});

// =============================
// FUNÇÃO: SOLICITAÇÕES DE CONTRACHEQUES ANTIGOS
// =============================
app.post('/solicitacoes-contracheques', async (req, res) => {
    try {
        const user = await validarUsuario(req, res);
        if (!user) return;

        const { referencia, motivo } = req.body;

        const { error } = await supabaseAdmin
            .from('solicitacoes_contracheques')
            .insert({
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

        let query = supabaseAdmin
            .from('solicitacoes_contracheques')
            .select('*')
            .order('criado_em', { ascending: false });
            

        if (user.user_metadata?.tipo !== 'admin') {
            query = query.eq('user_id', user.id);
        }

        const { data, error } = await query;

        if (error) return res.status(400).json({ erro: error.message });

        res.json(data || []);

    } catch (err) {
        res.status(500).json({ erro: err.message });
    }
});

app.put('/solicitacoes-contracheques/:id', async (req, res) => {

    try {

        const user =
            await validarUsuario(req, res);

        if (!user) return;

        if (
            user.user_metadata?.tipo !== 'admin'
        ) {

            return res.status(403).json({
                erro: 'Acesso negado'
            });
        }

        const { id } = req.params;

        const {
            status,
            resposta_financeiro
        } = req.body;

        console.log("ID:", id);
        console.log("BODY:", req.body);

        const { data, error } =
            await supabaseAdmin
                .from('solicitacoes_contracheques')
                .update({

                    status,

                    resposta_financeiro,

                    data_resposta:
                        new Date()
                })
                .eq('id', id)
                .select();

        if (error) {

            console.error(
                "ERRO UPDATE:",
                error
            );

            return res.status(400).json({
                erro: error.message
            });
        }

        res.json({
            sucesso: true,
            data
        });

    } catch (err) {

        console.error(
            "ERRO GERAL:",
            err
        );

        res.status(500).json({
            erro: err.message
        });
    }
});

// // =============================
// // FUNÇÃO: ATESTADOS
// // =============================
// app.post('/atestados', upload.single('arquivo'), async (req, res) => {

//     try {

//         const user = await validarUsuario(req, res);

//         if (!user) return;

//         if (!req.file) {
//             return res.status(400).json({
//                 erro: "Arquivo não enviado"
//             });
//         }

//         const pasta =
//             `${user.id}/${gerarTimestamp()}`;

//         const nomeArquivo =
//             req.file.originalname || 'atestado.pdf';

//         const caminho =
//             `${pasta}/${nomeArquivo}`;

//         // =========================
//         // STORAGE
//         // =========================

//         const { error: erroUpload } =
//             await supabaseAdmin.storage
//                 .from('atestados')
//                 .upload(
//                     caminho,
//                     req.file.buffer,
//                     {
//                         contentType:
//                             req.file.mimetype ||
//                             'application/octet-stream',

//                         upsert: true
//                     }
//                 );

//         if (erroUpload) {

//             return res.status(400).json({
//                 erro: erroUpload.message
//             });
//         }

//         // =========================
//         // URL PÚBLICA
//         // =========================

//         const {
//             data: publicUrlData
//         } = supabaseAdmin.storage
//             .from('atestados')
//             .getPublicUrl(caminho);

//         const arquivoURL =
//             publicUrlData.publicUrl;

//         // =========================
//         // EMAIL
//         // =========================

//         let statusEmail = 'nao_enviado';

//         if (
//             process.env.SMTP_HOST &&
//             process.env.SMTP_USER &&
//             process.env.SMTP_PASS
//         ) {

//             try {

//                 await transporter.sendMail({

//                     from:
//                         process.env.SMTP_USER,

//                     to:
//                         'financeiro@kidverte.com.br',

//                     subject:
//                         'Novo atestado enviado',

//                     html: `
//                         <h3>Novo atestado recebido</h3>

//                         <p>
//                             <strong>Funcionário:</strong>
//                             ${user.user_metadata?.full_name || ""}
//                         </p>

//                         <p>
//                             <strong>Email:</strong>
//                             ${user.email || ""}
//                         </p>

//                         <p>
//                             <a href="${arquivoURL}">
//                                 Baixar atestado
//                             </a>
//                         </p>
//                     `
//                 });

//                 statusEmail = 'enviado';

//             } catch (emailErr) {

//                 console.error(emailErr);

//                 statusEmail = 'erro_envio';
//             }
//         }

//         // =========================
//         // BANCO
//         // =========================

//         const { error: erroInsert } =
//             await supabaseAdmin
//                 .from('atestados')
//                 .insert({

//                     user_id:
//                         user.id,

//                     nome_usuario:
//                         user.user_metadata?.full_name || "",

//                     email_usuario:
//                         user.email || "",

//                     arquivo:
//                         caminho,

//                     nome_arquivo:
//                         nomeArquivo,

//                     email_financeiro:
//                         'financeiro@kidverte.com.br',

//                     status_email:
//                         statusEmail
//                 });

//         if (erroInsert) {

//             return res.status(400).json({
//                 erro: erroInsert.message
//             });
//         }

//         res.json({
//             sucesso: true
//         });

//     } catch (err) {

//         console.error(err);

//         res.status(500).json({
//             erro: err.message
//         });
//     }
// });


// // =============================
// // FUNÇÃO: ATESTADOS
// // =============================
// app.post('/atestados', upload.single('arquivo'), async (req, res) => {
//     try {
//         const user = await validarUsuario(req, res);
//         if (!user) return;

//         if (!req.file) {
//             return res.status(400).json({ erro: "Arquivo não enviado" });
//         }

//         const pasta = `${user.id}/${gerarTimestamp()}`;
//         const nomeArquivo = req.file.originalname || 'atestado.pdf';
//         const caminho = `${pasta}/${nomeArquivo}`;

//         const { error: erroUpload } = await supabaseAdmin.storage
//             .from('atestados')
//             .upload(caminho, req.file.buffer, {
//                 contentType: req.file.mimetype || 'application/octet-stream',
//                 upsert: true
//             });

//         if (erroUpload) return res.status(400).json({ erro: erroUpload.message });

//         const { error: erroInsert } = await supabaseAdmin
//             .from('atestados')
//             .insert({
//                 user_id: user.id,
//                 nome_usuario: user.user_metadata?.full_name || "",
//                 email_usuario: user.email || "",
//                 arquivo: caminho,
//                 nome_arquivo: nomeArquivo,
//                 email_financeiro: 'financeiro@kidverte.com.br',
//                 status_email: process.env.SMTP_HOST ? 'pendente_envio' : 'smtp_nao_configurado'
//             });

//         if (erroInsert) return res.status(400).json({ erro: erroInsert.message });

//         res.json({
//             sucesso: true,
//             aviso: process.env.SMTP_HOST
//                 ? null
//                 : "Atestado salvo. Configure SMTP_HOST/SMTP_USER/SMTP_PASS para envio automático ao financeiro."
//         });

//     } catch (err) {
//         res.status(500).json({ erro: err.message });
//     }
// });

//aqui


// =============================
// FUNÇÃO: LISTAR ATESTADOS
// =============================
app.get('/atestados', async (req, res) => {

    try {

        const admin =
            await validarAdmin(req, res);

        if (!admin) return;

        const { data, error } =
            await supabaseAdmin
                .from('atestados')
                .select('*')
                .order(
                    'criado_em',
                    { ascending: false }
                )
                .limit(100);

        if (error) {

            console.error(error);

            return res.status(400).json({
                erro: error.message
            });
        }

        res.json(data || []);

    } catch (err) {

        console.error(err);

        res.status(500).json({
            erro: err.message
        });
    }
});

// =============================
// FUNÇÃO: ENVIAR ATESTADO
// =============================
app.post(
    '/atestados',
    upload.single('arquivo'),
    async (req, res) => {

        try {

            const user =
                await validarUsuario(req, res);

            if (!user) return;

            if (!req.file) {

                return res.status(400).json({
                    erro: 'Arquivo não enviado'
                });
            }

            const pasta =
                `${user.id}/${gerarTimestamp()}`;

            const nomeArquivo =
                req.file.originalname ||
                'atestado.pdf';

            const caminho =
                `${pasta}/${nomeArquivo}`;

            // =============================
            // UPLOAD STORAGE
            // =============================

            const { error: erroUpload } =
                await supabaseAdmin.storage
                    .from('atestados')
                    .upload(
                        caminho,
                        req.file.buffer,
                        {
                            contentType:
                                req.file.mimetype ||
                                'application/octet-stream',

                            upsert: true
                        }
                    );

            if (erroUpload) {

                console.error(erroUpload);

                return res.status(400).json({
                    erro: erroUpload.message
                });
            }

            // =============================
            // INSERT BANCO
            // =============================

            const {
                data: atestadoData,
                error: erroInsert
            } = await supabaseAdmin
                .from('atestados')
                .insert({

                    user_id:
                        user.id,

                    nome_usuario:
                        user.user_metadata?.full_name || "",

                    email_usuario:
                        user.email || "",

                    arquivo:
                        caminho,

                    nome_arquivo:
                        nomeArquivo,

                    email_financeiro:
                        'financeiro@kidverte.com.br',

                    status_email:
                        'pendente_envio'
                })
                .select();

            if (erroInsert) {

                console.error(erroInsert);

                return res.status(400).json({
                    erro: erroInsert.message
                });
            }

            const atestado =
                atestadoData?.[0];

            // =============================
            // ENVIO EMAIL
            // =============================

            let statusEmail =
                'pendente_envio';

            if (!smtpConfigurado()) {
                console.warn("RESEND_API_KEY não configurado — email de atestado NÃO enviado.");
                statusEmail = 'smtp_nao_configurado';
            } else
            try {
                console.log('Resend configurado — enviando email de atestado...');

                await enviarEmail({
                    from: 'Portal Kidverte <nao-responda@kidverte.com.br>',
                    to: 'financeiro@kidverte.com.br',
                    replyTo: user.email,
                    subject: 'Novo atestado enviado',
                    html: `
                        <h3>Novo atestado recebido</h3>
                        <p><strong>Funcionário:</strong> ${user.user_metadata?.full_name}</p>
                        <p><strong>Email:</strong> ${user.email}</p>
                        <p><strong>Arquivo:</strong> ${nomeArquivo}</p>
                    `,
                    attachments: [
                        {
                            filename: nomeArquivo,
                            content: req.file.buffer
                        }
                    ]
                });

                console.log('EMAIL ATESTADO ENVIADO');
                statusEmail = 'enviado';

            } catch (emailErr) {

    console.error(
        "================ RESEND ERROR ================"
    );

    console.error(
        "MESSAGE:",
        emailErr.message
    );

    if (emailErr.resendError) {
        console.error(
            "RESEND DETAILS:",
            JSON.stringify(emailErr.resendError, null, 2)
        );
    }

    console.error(
        "FULL ERROR:"
    );

    console.error(emailErr);

    console.error(
        "==============================================="
    );

    statusEmail = 'erro_envio';
}

            // =============================
            // UPDATE STATUS
            // =============================

            if (atestado?.id) {

                await supabaseAdmin
                    .from('atestados')
                    .update({
                        status_email:
                            statusEmail
                    })
                    .eq(
                        'id',
                        atestado.id
                    );
            }

            // =============================
            // RESPOSTA
            // =============================

            res.json({
                sucesso: true,
                status_email:
                    statusEmail
            });

        } catch (err) {

            console.error(err);

            res.status(500).json({
                erro: err.message
            });
        }
    }
);



// =============================
// FUNÇÃO: UPLOAD + PROCESSAMENTO
// =============================
app.post('/upload', upload.single('pdf'), async (req, res) => {
    await processarPdfPorUsuario(req, res, 'contracheques');
});

app.post('/upload-ponto', upload.single('pdf'), async (req, res) => {
    await processarPdfPorUsuario(req, res, 'folhas-ponto');
});

// =============================
// FUNÇÃO: LISTAR USUÁRIOS
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

// =============================
// FUNÇÃO: EXCLUIR USUÁRIO
// =============================
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

// =============================
// ATUALIZAR USUÁRIO (EMAIL + SENHA)
// =============================
app.put('/users/:id', async (req, res) => {
    try {
        const admin = await validarAdmin(req, res);
        if (!admin) return;

        const userId = req.params.id;
        const { email, senha } = req.body;

        const dadosAtualizacao = {};

        if (email) dadosAtualizacao.email = email;
        if (senha) dadosAtualizacao.password = senha;

        const { data, error } = await supabaseAdmin.auth.admin.updateUserById(
            userId,
            dadosAtualizacao
        );

        if (error) {
            return res.status(400).json({ erro: error.message });
        }

        res.json({ sucesso: true, user: data });

    } catch (err) {
        res.status(500).json({ erro: err.message });
    }
});

// =============================
// FUNÇÃO: REGISTRAR CONFIRMAÇÃO
// =============================
app.post('/confirmacoes', async (req, res) => {
    try {
        const user = await validarUsuario(req, res);
        if (!user) return;

        const { arquivo } = req.body;

        if (!arquivo) {
            return res.status(400).json({ erro: "Arquivo não informado" });
        }

        const { data: existente, error: erroBusca } = await supabaseAdmin
            .from('confirmacoes_contracheque')
            .select('*')
            .eq('user_id', user.id)
            .eq('arquivo', arquivo)
            .limit(1);

        if (erroBusca) return res.status(400).json({ erro: erroBusca.message });

        if (existente && existente.length > 0) {
            return res.json({ sucesso: true, existente: true });
        }

        const { error: erroInsert } = await supabaseAdmin
            .from('confirmacoes_contracheque')
            .insert({
                user_id: user.id,
                nome_usuario: user.user_metadata?.full_name || "",
                arquivo,
                confirmado: true
            });

        if (erroInsert) return res.status(400).json({ erro: erroInsert.message });

        res.json({ sucesso: true, existente: false });

    } catch (err) {
        res.status(500).json({ erro: err.message });
    }
});

// =============================
// FUNÇÃO: VERIFICAR CONFIRMAÇÃO
// =============================
app.get('/confirmacoes/status', async (req, res) => {
    try {
        const user = await validarUsuario(req, res);
        if (!user) return;

        const arquivo = req.query.arquivo;

        if (!arquivo) {
            return res.status(400).json({ erro: "Arquivo não informado" });
        }

        const { data, error } = await supabaseAdmin
            .from('confirmacoes_contracheque')
            .select('*')
            .eq('user_id', user.id)
            .eq('arquivo', arquivo)
            .limit(1);

        if (error) return res.status(400).json({ erro: error.message });

        res.json({ confirmado: !!(data && data.length > 0) });

    } catch (err) {
        res.status(500).json({ erro: err.message });
    }
});

// =============================
// FUNÇÃO: LISTAR CONFIRMAÇÕES
// =============================
app.get('/confirmacoes', async (req, res) => {
    try {
        const admin = await validarAdmin(req, res);
        if (!admin) return;

        const { data, error } = await supabaseAdmin
            .from('confirmacoes_contracheque')
            .select('*')
            .limit(100);

        if (error) return res.status(400).json({ erro: error.message });

        const confirmacoesOrdenadas = (data || []).sort((a, b) => {
            const dataA = new Date(a.criado_em || a.data || a.data_confirmacao || 0).getTime();
            const dataB = new Date(b.criado_em || b.data || b.data_confirmacao || 0).getTime();

            return dataB - dataA;
        });

        let confirmacoes = [];
        const vistos = new Set();

        for (const confirmacao of confirmacoesOrdenadas) {
            const chave = `${confirmacao.user_id || ""}::${confirmacao.arquivo || ""}`;

            if (vistos.has(chave)) continue;

            vistos.add(chave);
            confirmacoes.push(confirmacao);
        }

        if (req.query.periodo === 'recentes') {
            const limite = new Date();
            limite.setDate(limite.getDate() - 30);

            confirmacoes = confirmacoes.filter(confirmacao => {
                const dataConfirmacao = new Date(
                    confirmacao.criado_em ||
                    confirmacao.data ||
                    confirmacao.data_confirmacao ||
                    0
                );

                return dataConfirmacao >= limite;
            });
        }

        res.json(confirmacoes);

    } catch (err) {
        res.status(500).json({ erro: err.message });
    }
});

app.use(cors());
app.use(express.static('public'));
// =============================
// START SERVIDOR
// =============================
const PORT = process.env.PORT || 3000;

// =============================
// ROTA INICIAL
// =============================
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'login.html'));
});

app.listen(PORT, () => {
    console.log(`Servidor rodando na porta ${PORT}`);
});


