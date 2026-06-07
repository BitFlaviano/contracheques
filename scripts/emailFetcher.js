const Imap = require('imap');
const { simpleParser } = require('mailparser');
const https = require('https');
const http = require('http');
const path = require('path');
const fs = require('fs');
const os = require('os');

const IMAP_CONFIG = {
    user: 'financeiro@kidverte.com.br',
    password: 'cfc@5832',
    host: 'imap.titan.email',
    port: 993,
    tls: true,
    tlsOptions: { rejectUnauthorized: false },
    connTimeout: 30000,
    authTimeout: 30000
};

const SENDERS = {
    contbh: { from: 'pessoal@contbh.com.br', name: 'PESSOAL CONTBH' },
    acmais: { from: 'noreply@acessorias.com', name: 'Genilda Gomes | ACMais Contabilidade Consultiva' }
};

const ATTACHMENT_NAMES = [
    'Recibo de pagamento Distribuidora FCC.pdf',
    'Recibo de pagamento FC UTIL.pdf'
];

function getTempDir() {
    const dir = path.join(os.tmpdir(), 'email-fetcher');
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    return dir;
}

function downloadUrl(url) {
    return new Promise((resolve, reject) => {
        const client = url.startsWith('https') ? https : http;
        client.get(url, { rejectUnauthorized: false }, (res) => {
            if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
                downloadUrl(res.headers.location).then(resolve).catch(reject);
                return;
            }
            if (res.statusCode !== 200) {
                reject(new Error(`HTTP ${res.statusCode} ao baixar ${url}`));
                return;
            }
            const chunks = [];
            res.on('data', (c) => chunks.push(c));
            res.on('end', () => resolve(Buffer.concat(chunks)));
        }).on('error', reject);
    });
}

function conectarImap() {
    return new Promise((resolve, reject) => {
        const imap = new Imap(IMAP_CONFIG);
        imap.once('ready', () => resolve(imap));
        imap.once('error', reject);
        imap.connect();
    });
}

function abrirCaixa(imap, nome) {
    return new Promise((resolve, reject) => {
        imap.openBox(nome, false, (err, box) => {
            if (err) reject(err);
            else resolve(box);
        });
    });
}

function buscarEmails(imap, criterios) {
    return new Promise((resolve, reject) => {
        imap.search(criterios, (err, uids) => {
            if (err) reject(err);
            else resolve(uids);
        });
    });
}

function fetchEmail(imap, uid) {
    return new Promise((resolve, reject) => {
        const f = imap.fetch(uid, { bodies: '', struct: true });
        const partes = [];
        f.on('message', (msg) => {
            msg.on('body', (stream) => {
                const chunks = [];
                stream.on('data', (c) => chunks.push(c.toString('utf8')));
                stream.on('end', () => partes.push(chunks.join('')));
            });
        });
        f.on('end', () => {
            simpleParser(partes.join(''), (err, parsed) => {
                if (err) reject(err);
                else resolve(parsed);
            });
        });
        f.on('error', reject);
    });
}

function extrairLinkRecibo(html) {
    const match = html.match(/RECIBO DE PAGAMENTO.*?<a[^>]*href="([^"]+)"[^>]*>/i);
    if (match) return match[1];
    const match2 = html.match(/RECIBO DE PAGAMENTO.*?«([^»]+)»/i);
    if (match2) return match2[1];
    return null;
}

function isCorrente(mes) {
    const agora = new Date();
    const mesAtual = agora.getMonth() + 1;
    const anoAtual = agora.getFullYear();
    return mes.mes === mesAtual && mes.ano === anoAtual;
}

function extrairMesAno(subject) {
    const match = subject.match(/(\d{2})\/(\d{4})/);
    if (match) return { mes: parseInt(match[1]), ano: parseInt(match[2]) };
    return null;
}

async function processarContbh(imap, uids, resultados) {
    for (const uid of uids) {
        try {
            const email = await fetchEmail(imap, uid);
            const mesAno = extrairMesAno(email.subject || '');
            if (!mesAno) continue;
            if (!isCorrente(mesAno)) continue;

            if (!email.attachments || email.attachments.length === 0) continue;

            for (const anexo of email.attachments) {
                if (!ATTACHMENT_NAMES.includes(anexo.filename)) continue;
                const tempPath = path.join(getTempDir(), `${Date.now()}_${anexo.filename}`);
                fs.writeFileSync(tempPath, anexo.content);
                resultados.push({
                    filename: anexo.filename,
                    tempPath,
                    mes: mesAno.mes,
                    ano: mesAno.ano,
                    buffer: anexo.content
                });
            }
        } catch (e) {
            console.error('Erro ao processar email CONTBH:', e.message);
        }
    }
}

async function processarAcmais(imap, uids, resultados) {
    for (const uid of uids) {
        try {
            const email = await fetchEmail(imap, uid);
            const mesAno = extrairMesAno(email.subject || '');
            if (!mesAno) continue;
            if (!isCorrente(mesAno)) continue;

            const html = email.html || email.textAsHtml || '';
            const link = extrairLinkRecibo(html);
            if (!link) continue;

            const pdfBuffer = await downloadUrl(link);
            const filename = `Recibo ACMais ${mesAno.mes}${mesAno.ano}.pdf`;
            const tempPath = path.join(getTempDir(), `${Date.now()}_${filename}`);
            fs.writeFileSync(tempPath, pdfBuffer);
            resultados.push({
                filename,
                tempPath,
                mes: mesAno.mes,
                ano: mesAno.ano,
                buffer: pdfBuffer
            });
        } catch (e) {
            console.error('Erro ao processar email ACMais:', e.message);
        }
    }
}

async function buscarDocumentos() {
    const resultados = [];
    let imap;
    try {
        imap = await conectarImap();
        await abrirCaixa(imap, 'INBOX');

        const agora = new Date();
        const ano = agora.getFullYear();
        const mes = agora.getMonth() + 1;
        const primeiroDia = `${ano}-${String(mes).padStart(2, '0')}-01`;
        const sextoDia = `${ano}-${String(mes).padStart(2, '0')}-06`;

        const criterios = [['SINCE', primeiroDia], ['BEFORE', sextoDia]];

        // CONTBH
        const uidsContbh = await buscarEmails(imap, [
            ...criterios,
            ['FROM', SENDERS.contbh.from],
            ['SUBJECT', 'FOLHA DE PAGAMENTO']
        ]);
        await processarContbh(imap, uidsContbh, resultados);

        // ACMais
        const uidsAcmais = await buscarEmails(imap, [
            ...criterios,
            ['FROM', SENDERS.acmais.from],
            ['SUBJECT', 'FOLHA DE PAGAMENTO']
        ]);
        await processarAcmais(imap, uidsAcmais, resultados);

        imap.end();
    } catch (e) {
        console.error('Erro no email fetcher:', e.message);
        if (imap) try { imap.end(); } catch (_) {}
    }
    return resultados;
}

module.exports = { buscarDocumentos };
