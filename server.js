const express = require('express');
const cors = require('cors');
const multer = require('multer');
const { createClient } = require('@supabase/supabase-js');
const { PDFDocument } = require('pdf-lib');
const pdfParse = require('pdf-parse');
const path = require('path');

const app = express();
app.use(express.json());
app.use(cors());
app.use(express.static(path.join(__dirname, 'public')));

// =============================
// CONFIGURAÇÕES
// =============================
const SUPABASE_URL = 'https://uatryxvylqwslnaxggjk.supabase.co';
const SUPABASE_SERVICE_ROLE = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InVhdHJ5eHZ5bHF3c2xuYXhnZ2prIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3NzAwODk5OSwiZXhwIjoyMDkyNTg0OTk5fQ.Sy3jX2ZbRFIHR2GI_8TrOE4uxMQz__K3MqK-LClsMwg';
const supabaseAdmin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE);

const upload = multer({ storage: multer.memoryStorage() });

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
// FUNÇÃO: UPLOAD + PROCESSAMENTO
// =============================
app.post('/upload', upload.single('pdf'), async (req, res) => {
    try {
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

            // cria PDF da página
            const novoPdf = await PDFDocument.create();
            const [pagina] = await novoPdf.copyPages(pdfDoc, [i]);
            novoPdf.addPage(pagina);

            const pdfBytes = await novoPdf.save();

            // extrai texto da página
            const dadosPagina = await pdfParse(Buffer.from(pdfBytes));
            const textoPagina = dadosPagina.text;

            const nome = identificarUsuario(textoPagina, usuarios);
            const mes = extrairMes(textoPagina);

            if (!nome) {
                console.log(`Página ${i+1} sem usuário identificado`);
                continue;
            }

            // NOVO PADRÃO → COM ESPAÇO
            const nomeArquivo = `${nome} ${mes}.pdf`;

            const caminho = `${pastaUpload}/${nomeArquivo}`;

            const { error } = await supabaseAdmin.storage
                .from('contracheques')
                .upload(caminho, pdfBytes, {
                    contentType: 'application/pdf',
                    upsert: true
                });

            if (error) {
                console.log("ERRO STORAGE:", error.message);
            } else {
                console.log("SALVO:", caminho);
                salvouAlgum = true;
            }
        }

        if (!salvouAlgum) {
            return res.status(400).json({
                erro: "Nenhum arquivo foi salvo."
            });
        }

        res.json({
            sucesso: true
        });

    } catch (err) {
        console.error("ERRO:", err);
        res.status(500).json({ erro: err.message });
    }
});

// =============================
// FUNÇÃO: LISTAR USUÁRIOS
// =============================
app.get('/users', async (req, res) => {
    try {
        if (req.headers.authorization !== "admin123") {
            return res.status(403).json({ erro: "Acesso negado" });
        }

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
        if (req.headers.authorization !== "admin123") {
            return res.status(403).json({ erro: "Acesso negado" });
        }

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
        if (req.headers.authorization !== "admin123") {
            return res.status(403).json({ erro: "Acesso negado" });
        }

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

app.use(cors());
app.use(express.static('public'));
// =============================
// START SERVIDOR
// =============================
const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
    console.log(`Servidor rodando na porta ${PORT}`);
});


