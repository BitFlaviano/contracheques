// =============================
// CONFIGURAÇÃO SUPABASE
// =============================
const SUPABASE_URL = 'https://uatryxvylqwslnaxggjk.supabase.co';
const SUPABASE_KEY = 'sb_publishable_hIM2Rl5P2BtJHRmLg7qzHQ_dM6tJoxj';

const client = supabase.createClient(
    SUPABASE_URL,
    SUPABASE_KEY
);

const API_URL = "";

let userIdSelecionado = null;
let fazendoLogin = false;
let enviandoArquivo = false;
let arquivoPendente = null;
let confirmandoDownload = false;


// =============================
// VALIDAÇÕES
// =============================
function emailValido(email) {
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

function normalizarTexto(texto) {
    return texto
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "")
        .toUpperCase();
}

// =============================
// LOGIN
// =============================
async function fazerLogin() {

    if (fazendoLogin) return;

    fazendoLogin = true;

    const login = document.getElementById('email')?.value.trim();
    const password = document.getElementById('password')?.value;
    const erroDisplay = document.getElementById('mensagem-erro');

    if (erroDisplay) {
        erroDisplay.innerText = "";
    }

    try {

        if (!login || !password) {

            if (erroDisplay) {
                erroDisplay.innerText = "Preencha e-mail/CPF e senha.";
            }

            return;
        }

        const resolveLogin = await fetch(`${API_URL}/resolve-login`, {
            method: "POST",
            headers: {
                "Content-Type": "application/json"
            },
            body: JSON.stringify({ login })
        });

        const resolveData = await resolveLogin.json().catch(() => ({}));

        if (!resolveLogin.ok || !resolveData.email) {
            if (erroDisplay) {
                erroDisplay.innerText = resolveData?.erro || "Login inválido.";
            }

            return;
        }

        const { data, error } =
            await client.auth.signInWithPassword({
                email: resolveData.email,
                password
            });

        if (error) {

            if (erroDisplay) {
                erroDisplay.innerText = "Email ou senha inválidos.";
            }

            return;
        }

        const user = data.user;
        const tipo = user.user_metadata?.tipo;
        localStorage.setItem("ultima_atividade", String(Date.now()));

        if (tipo === "admin") {

            window.location.href =
                "admin.html";

        } else if (
            tipo === "user" ||
            tipo === "funcionario"
        ) {

            window.location.href =
                "user.html";

        } else {

            erroDisplay.innerText =
                "Tipo de usuário inválido.";
        }

    } catch (err) {

        console.error(err);

        if (erroDisplay) {
            erroDisplay.innerText = "Erro ao realizar login.";
        }

    } finally {

        fazendoLogin = false;
    }
}

// =====================================
// CONTROLE DE SESSÃO POR INATIVIDADE
// =====================================

let tempoInatividade;
let controleSessaoAtivo = false;
const TEMPO_LIMITE = 5 * 60 * 1000; // 5 minutos

function resetarTempoSessao() {

    if (!controleSessaoAtivo) return;

    clearTimeout(tempoInatividade);
    localStorage.setItem("ultima_atividade", String(Date.now()));

    tempoInatividade = setTimeout(async () => {

        alert(
            "Sessão encerrada por inatividade."
        );

        await client.auth.signOut();

        window.location.href =
            "login.html";

    }, TEMPO_LIMITE);
}

async function iniciarControleSessao() {
    const ultimaAtividade = Number(localStorage.getItem("ultima_atividade") || Date.now());

    if (Date.now() - ultimaAtividade > TEMPO_LIMITE) {
        await fazerLogout();
        return false;
    }

    controleSessaoAtivo = true;
    resetarTempoSessao();
    return true;
}

function pararControleSessao() {
    controleSessaoAtivo = false;
    clearTimeout(tempoInatividade);
}

// eventos considerados interação
[
    "mousemove",
    "mousedown",
    "keypress",
    "scroll",
    "touchstart",
    "click"
].forEach(evento => {

    document.addEventListener(
        evento,
        resetarTempoSessao
    );
});

// =============================
// LOGOUT
// =============================
async function fazerLogout() {

    pararControleSessao();
    localStorage.removeItem("ultima_atividade");
    await client.auth.signOut();

    window.location.href = 'login.html';
}

function irCadastro() {
    window.location.href = "cadastro.html";
}

function irUpload() {
    window.location.href = "upload.html";
}

function irUploadPonto() {
    window.location.href = "upload-ponto.html";
}

function irConfirmacoes() {
    window.location.href = "confirmacoes.html";
}

function toggleMenuMobile() {
    document.querySelector(".menu")?.classList.toggle("menu-aberto");
}

function mostrarSecaoUser(id) {
    document.querySelectorAll(".secao-menu-user").forEach(secao => {
        secao.hidden = secao.id !== id;
    });

    document.querySelector(".menu")?.classList.remove("menu-aberto");
}

function configurarComboAnosSolicitacao() {
    const select = document.getElementById("solicitacao-ano");

    if (!select || select.options.length > 0) return;

    const anoAtual = new Date().getFullYear();

    [anoAtual, anoAtual - 1].forEach(ano => {
        const option = document.createElement("option");
        option.value = String(ano);
        option.textContent = String(ano);
        select.appendChild(option);
    });
}

// =============================
// DASHBOARD USUÁRIO
// =============================
async function carregarDashboard(user) {

    const lista = document.getElementById('lista-arquivos');
    const listaPonto = document.getElementById('lista-ponto');
    const loadingUser = document.getElementById('loading-user');
    const btn = document.getElementById('btn-refresh');
    const nomeSpan = document.getElementById("nome-usuario");

    if (nomeSpan) {
        nomeSpan.innerText =
            user.user_metadata?.full_name || "Colaborador";
    }

    if (lista) lista.innerHTML = "";
    if (listaPonto) listaPonto.innerHTML = "";
    if (loadingUser) loadingUser.style.display = "block";
    if (btn) btn.style.display = "none";

    try {

        const session = await client.auth.getSession();
        const token = session.data.session?.access_token;

        if (!token) {
            window.location.href = "login.html";
            return;
        }

        const [resContracheques, resPonto] = await Promise.all([
            fetch(`${API_URL}/documentos?tipo=contracheque`, {
                headers: { Authorization: `Bearer ${token}` }
            }),
            fetch(`${API_URL}/documentos?tipo=folha-ponto`, {
                headers: { Authorization: `Bearer ${token}` }
            })
        ]);

        const contracheques = resContracheques.ok
            ? await resContracheques.json()
            : [];

        const folhas = resPonto.ok
            ? await resPonto.json()
            : [];

        renderizarListaDocumentos(
            lista,
            contracheques,
            "Nenhum contracheque disponível nos últimos 3 meses."
        );

        renderizarListaDocumentos(
            listaPonto,
            folhas,
            "Nenhuma folha de ponto disponível neste mês."
        );

    } catch (err) {

        console.error(err);

        if (lista) {
            lista.innerText = "Erro inesperado.";
        }

    } finally {

        if (loadingUser) {
            loadingUser.style.display = "none";
        }

        if (btn) {
            btn.style.display = "flex";
        }
    }
}

function renderizarListaDocumentos(container, documentos, mensagemVazia) {
    if (!container) return;

    container.innerHTML = "";

    if (!documentos || documentos.length === 0) {
        container.innerText = mensagemVazia;
        return;
    }

    documentos.forEach(file => {
        const div = document.createElement('div');
        div.className = "documento";

        const span = document.createElement('span');
        span.innerText = file.nome;

        const button = document.createElement('button');
        button.className = "btn-download";
        button.innerText = "Baixar";

        button.addEventListener('click', () => {
            if (file.tipo === "contracheque") {
                baixarArquivo(file.caminho);
                return;
            }

            baixarDocumentoDireto(file.bucket, file.caminho);
        });

        div.appendChild(span);
        div.appendChild(button);

        container.appendChild(div);
    });
}

// =====================================
// RECUPERAÇÃO DE SENHA
// =====================================

    async function recuperarSessao() {

        const hash =
            window.location.hash;

        if (!hash) return;

        const params =
            new URLSearchParams(
                hash.substring(1)
            );

        const access_token =
            params.get("access_token");

        const refresh_token =
            params.get("refresh_token");

        if (
            access_token &&
            refresh_token
        ) {

            await client.auth.setSession({
                access_token,
                refresh_token
            });
        }
    }

// =====================================
// RECUPERAÇÃO DE SENHA
// =====================================

async function abrirRecuperacaoSenha() {

    const emailLogin = document.getElementById("email")?.value.trim() || "";
    const modal = document.getElementById("modal-recuperacao");
    const emailRecuperacao = document.getElementById("email-recuperacao");
    const msg = document.getElementById("msg-recuperacao");

    if (emailRecuperacao) {
        emailRecuperacao.value = emailLogin.includes("@") ? emailLogin : "";
    }

    if (msg) {
        msg.innerText = "";
    }

    if (modal) {
        modal.style.display = "flex";
    }
}

function fecharRecuperacaoSenha() {
    const modal = document.getElementById("modal-recuperacao");

    if (modal) {
        modal.style.display = "none";
    }
}

async function enviarRecuperacaoSenha() {

    const email = document.getElementById("email-recuperacao")?.value.trim();
    const msg = document.getElementById("msg-recuperacao");

    if (!email) {
        if (msg) {
            msg.innerText = "Informe o e-mail cadastrado.";
            msg.style.color = "red";
        }
        return;
    }

    const {
        error
    } = await client.auth.resetPasswordForEmail(
        email,
        {
            redirectTo:
                `${window.location.origin}/reset-password.html`
        }
    );

    if (error) {

        if (msg) {
            msg.innerText = "Erro ao enviar e-mail.";
            msg.style.color = "red";
        }

        console.error(error);

        return;
    }

    if (msg) {
        msg.innerText = "Link enviado. Verifique seu e-mail e a caixa de spam.";
        msg.style.color = "green";
    }
}

// =============================
// ALTERAÇÃO NO ESQUECI A SENHA
// =============================
async function alterarSenha() {

            const msg =
                document.getElementById(
                    "msg"
                );

            const senha =
                document.getElementById(
                    "nova-senha"
                ).value;

            const confirmarSenha =
                document.getElementById(
                    "confirmar-senha"
                ).value;

            if (senha !== confirmarSenha) {

                msg.innerText =
                    "As senhas não coincidem.";

                msg.style.color =
                    "red";

                return;
            }    

            if (senha.length < 6) {

                msg.innerText =
                    "Senha muito curta.";

                msg.style.color =
                    "red";

                return;
            }

            const {
                error
            } = await client.auth.updateUser({
                password: senha
            });

            if (error) {

                msg.innerText =
                    error.message;

                msg.style.color =
                    "red";

                return;
            }

            msg.innerText =
                "Senha alterada com sucesso!";

            msg.style.color =
                "green";

            setTimeout(() => {

                window.location.href =
                    "login.html";

            }, 2000);
        }           

// =============================
// BAIXAR ARQUIVO
// =============================
async function baixarArquivo(caminho) {

    try {

        const session = await client.auth.getSession();
        const token = session.data.session?.access_token;

        if (!token) {
            window.location.href = "login.html";
            return;
        }

        const res = await fetch(
            `${API_URL}/confirmacoes/status?arquivo=${encodeURIComponent(caminho)}`,
            {
                headers: {
                    Authorization: `Bearer ${token}`
                }
            }
        );

        if (!res.ok) {
            throw new Error("Erro ao verificar confirmação.");
        }

        const data = await res.json();

        if (data.confirmado) {
            await baixarArquivoConfirmado(caminho);
            return;
        }

        arquivoPendente = caminho;

        const modal =
            document.getElementById(
                "modal-termos"
            );

        if (modal) {
            modal.style.display = "flex";
        }

    } catch (err) {

        console.error(err);
        alert("Erro ao verificar confirmação do documento.");
    }
}

async function baixarArquivoConfirmado(caminho) {
    return baixarDocumentoDireto("contracheques", caminho);
}

async function baixarDocumentoDireto(bucket, caminho) {
    const session = await client.auth.getSession();
    const token = session.data.session?.access_token;

    if (!token) {
        window.location.href = "login.html";
        return false;
    }

    const res = await fetch(
        `${API_URL}/download-documento?bucket=${encodeURIComponent(bucket)}&caminho=${encodeURIComponent(caminho)}`,
        {
            headers: {
                Authorization: `Bearer ${token}`
            }
        }
    );

    if (!res.ok) {
        const erro = await res.json().catch(() => ({}));
        alert(erro?.erro || "Erro ao baixar.");
        return false;
    }

    const arquivo = await res.blob();
    const url =
        URL.createObjectURL(arquivo);

    const a =
        document.createElement("a");

    a.href = url;

    a.download =
        caminho
            .split("/")
            .pop();

    a.click();

    URL.revokeObjectURL(url);

    return true;
}

async function confirmarDownload() {

    if (confirmandoDownload) return;

    const checkbox =
        document.getElementById(
            "aceite-termos"
        );

    if (!checkbox.checked) {

        alert(
            "Você deve aceitar os termos."
        );

        return;
    }

    const { data } =
        await client.auth.getUser();

    const user = data.user;
    const session = await client.auth.getSession();
    const token = session.data.session?.access_token;

    if (!token || !user) {
        window.location.href = "login.html";
        return;
    }

    confirmandoDownload = true;

    try {

        const resConfirmacao = await fetch(`${API_URL}/confirmacoes`, {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                Authorization: `Bearer ${token}`
            },
            body: JSON.stringify({
                arquivo: arquivoPendente
            })
        });

        if (!resConfirmacao.ok) {
            const erro = await resConfirmacao.json().catch(() => ({}));
            alert(erro?.erro || "Erro ao registrar confirmação.");
            return;
        }

        const baixou = await baixarArquivoConfirmado(arquivoPendente);

        if (!baixou) return;

        // fecha modal
        document.getElementById(
            "modal-termos"
        ).style.display = "none";

        checkbox.checked = false;
        arquivoPendente = null;

        if (typeof carregarConfirmacoes === "function") {
            carregarConfirmacoes();
        }

    } finally {
        confirmandoDownload = false;
    }

}

function fecharModalTermos() {
    const modal = document.getElementById("modal-termos");
    const checkbox = document.getElementById("aceite-termos");

    if (modal) {
        modal.style.display = "none";
    }

    if (checkbox) {
        checkbox.checked = false;
    }

    arquivoPendente = null;
    confirmandoDownload = false;
}

// =============================
// CADASTRAR USUÁRIO
// =============================
async function cadastrar() {

    const nome = document.getElementById("nome")?.value.trim().toUpperCase();
    const email = document.getElementById("email")?.value.trim().toLowerCase();
    const senha = document.getElementById("senha")?.value;
    const cpf = document.getElementById("cpf")?.value.trim().replace(/\D/g, "");
    const tipo = document.getElementById("tipo").value;
const msg = document.getElementById("msg");

// remove caracteres não numéricos
const cpfLimpo = cpf.replace(/\D/g, "");

// valida tamanho
if (cpfLimpo.length !== 11) {

    msg.innerText = "CPF inválido.";
    msg.style.color = "red";

    return;
}

// evita sequências iguais
if (/^(\d)\1+$/.test(cpfLimpo)) {

    msg.innerText = "CPF inválido.";
    msg.style.color = "red";

    return;
}

// valida dígitos do CPF
function validarCPF(cpf) {

    let soma = 0;
    let resto;

    for (let i = 1; i <= 9; i++) {
        soma += parseInt(cpf.substring(i - 1, i)) * (11 - i);
    }

    resto = (soma * 10) % 11;

    if (resto === 10 || resto === 11) {
        resto = 0;
    }

    if (resto !== parseInt(cpf.substring(9, 10))) {
        return false;
    }

    soma = 0;

    for (let i = 1; i <= 10; i++) {
        soma += parseInt(cpf.substring(i - 1, i)) * (12 - i);
    }

    resto = (soma * 10) % 11;

    if (resto === 10 || resto === 11) {
        resto = 0;
    }

    return resto === parseInt(cpf.substring(10, 11));
}

if (!validarCPF(cpfLimpo)) {

    msg.innerText = "CPF inválido.";
    msg.style.color = "red";

    return;
}

    try {

        if (!nome || !email || !senha || !cpf) {

            msg.innerText = "Preencha todos os campos.";
            msg.style.color = "red";

            return;
        }

        if (!emailValido(email)) {

            msg.innerText = "Email inválido.";
            msg.style.color = "red";

            return;
        }

        if (senha.length < 6) {

            msg.innerText =
                "Senha deve possuir ao menos 6 caracteres.";

            msg.style.color = "red";

            return;
        }

        const res = await fetch(`${API_URL}/register`, {

            method: "POST",

            headers: {
                "Content-Type": "application/json"
            },

            body: JSON.stringify({
                nome,
                email,
                senha,
                cpf: cpfLimpo,
                tipo
            })
        });

        const data = await res.json();

        if (res.ok) {

            msg.innerText =
                "Usuário cadastrado com sucesso.";

            msg.style.color = "green";

            document.getElementById("nome").value = "";
            document.getElementById("email").value = "";
            document.getElementById("senha").value = "";
            document.getElementById("cpf").value = "";
            document.getElementById("tipo").value = "user";

        } else {

            msg.innerText =
                data?.erro || "Erro ao cadastrar.";

            msg.style.color = "red";
        }

    } catch (err) {

        console.error(err);

        msg.innerText =
            "Erro ao conectar ao servidor.";

        msg.style.color = "red";
    }
}

// =============================
// CARREGAR USUÁRIOS
// =============================
async function carregarUsuarios() {

    const lista = document.getElementById("lista-usuarios");
    const loading = document.getElementById("loading-usuarios");

    if (!lista) return;

    // limpa lista
    lista.innerHTML = "";

    // loading
    if (loading) {
        loading.style.display = "block";
    }

    try {

        // pega sessão atual
        const session = await client.auth.getSession();

        const token =
            session.data.session?.access_token;

        // proteção
        if (!token) {

            window.location.href = "login.html";

            return;
        }

        // busca usuários
        const res = await fetch(`${API_URL}/users`, {

            headers: {
                "Authorization": `Bearer ${token}`
            }
        });

        // erro backend
        if (!res.ok) {

            throw new Error(
                "Erro ao carregar usuários"
            );
        }

        const usuarios = await res.json();

        // remove loading
        if (loading) {
            loading.style.display = "none";
        }

        // sem usuários
        if (!usuarios || usuarios.length === 0) {

            lista.innerHTML =
                "<p>Nenhum usuário encontrado.</p>";

            return;
        }

        // limpa novamente
        lista.innerHTML = "";

        usuarios.forEach(user => {

            // container
            const div =
                document.createElement("div");

            div.className = "user";

            // nome
            const nome =
                user.user_metadata?.full_name ||
                "Sem nome";

            // user-info
            const userInfo =
                document.createElement("div");

            userInfo.className = "user-info";

            // nome seguro
            const strong =
                document.createElement("strong");

            strong.textContent = nome;

            // email seguro
            const span =
                document.createElement("span");

            span.textContent =
                user.email || "";

            userInfo.appendChild(strong);
            userInfo.appendChild(span);

            // actions
            const actions =
                document.createElement("div");

            actions.className = "actions";

            // botão alterar
            const btnAlterar =
                document.createElement("button");

            btnAlterar.className =
                "btn-password";

            btnAlterar.textContent =
                "Alterar Cadastro";

            // botão excluir
            const btnExcluir =
                document.createElement("button");

            btnExcluir.className =
                "btn-delete";

            btnExcluir.textContent =
                "Excluir";

            // eventos
            btnAlterar.addEventListener(
                "click",
                () => {
                    alterarCadastroUsuario(
                        user.id,
                        user.email
                    );
                }
            );

            btnExcluir.addEventListener(
                "click",
                () => {
                    deletarUsuario(user.id);
                }
            );

            // adiciona botões
            actions.appendChild(btnAlterar);
            actions.appendChild(btnExcluir);

            // adiciona conteúdo
            div.appendChild(userInfo);
            div.appendChild(actions);

            // adiciona lista
            lista.appendChild(div);
        });

    } catch (err) {

        console.error(
            "ERRO AO CARREGAR USUÁRIOS:",
            err
        );

        if (loading) {
            loading.style.display = "none";
        }

        lista.innerHTML =
            "Erro ao carregar usuários.";
    }
}

function formatarDataHora(valor) {
    if (!valor) return "-";

    const data = new Date(valor);

    if (Number.isNaN(data.getTime())) {
        return "-";
    }

    return data.toLocaleString("pt-BR", {
        day: "2-digit",
        month: "2-digit",
        year: "numeric",
        hour: "2-digit",
        minute: "2-digit"
    });
}

// =============================
// CARREGAR CONFIRMAÇÕES
// =============================
async function carregarConfirmacoes() {

    const lista = document.getElementById("lista-confirmacoes");
    const loading = document.getElementById("loading-confirmacoes");

    if (!lista) return;

    lista.innerHTML = "";

    if (loading) {
        loading.style.display = "block";
    }

    try {

        const session = await client.auth.getSession();
        const token = session.data.session?.access_token;

        if (!token) {
            window.location.href = "login.html";
            return;
        }

        const paginaConfirmacoes = window.location.pathname
            .toLowerCase()
            .includes("confirmacoes");

        const periodo = paginaConfirmacoes ? "" : "?periodo=recentes";

        const res = await fetch(`${API_URL}/confirmacoes${periodo}`, {
            headers: {
                Authorization: `Bearer ${token}`
            }
        });

        if (!res.ok) {
            throw new Error("Erro ao carregar confirmações");
        }

        const confirmacoes = await res.json();

        if (!confirmacoes || confirmacoes.length === 0) {
            lista.innerHTML = "<p>Nenhuma confirmação encontrada.</p>";
            return;
        }

        const tabela = document.createElement("div");
        tabela.className = "confirmacoes-lista";

        confirmacoes.forEach(confirmacao => {
            const item = document.createElement("div");
            item.className = "confirmacao";

            const info = document.createElement("div");
            info.className = "confirmacao-info";

            const nome = document.createElement("strong");
            nome.textContent = confirmacao.nome_usuario || "Sem nome";

            const arquivo = document.createElement("span");
            arquivo.textContent = confirmacao.arquivo || "Arquivo não informado";

            const data = document.createElement("small");
            data.textContent = formatarDataHora(
                confirmacao.created_at ||
                confirmacao.data ||
                confirmacao.data_confirmacao
            );

            info.appendChild(nome);
            info.appendChild(arquivo);
            info.appendChild(data);

            const status = document.createElement("span");
            status.className = confirmacao.confirmado
                ? "status-confirmado"
                : "status-pendente";
            status.textContent = confirmacao.confirmado
                ? "Confirmado"
                : "Pendente";

            item.appendChild(info);
            item.appendChild(status);
            tabela.appendChild(item);
        });

        lista.appendChild(tabela);

    } catch (err) {

        console.error("ERRO AO CARREGAR CONFIRMAÇÕES:", err);

        lista.innerHTML = "Erro ao carregar confirmações.";

    } finally {

        if (loading) {
            loading.style.display = "none";
        }
    }
}

// =============================
// EXCLUIR USUÁRIO
// =============================
async function deletarUsuario(userId) {

    if (!confirm("Deseja excluir este usuário?")) {
        return;
    }

    try {

        const session =
            await client.auth.getSession();

        const token =
            session.data.session?.access_token;

        const res = await fetch(
            `${API_URL}/users/${userId}`,
            {
                method: "DELETE",

                headers: {
                    Authorization: `Bearer ${token}`
                }
            }
        );

        if (res.ok) {

            alert("Usuário excluído.");

            carregarUsuarios();

        } else {

            alert("Erro ao excluir usuário.");
        }

    } catch (err) {

        console.error(err);

        alert("Erro inesperado.");
    }
}

// =============================
// ALTERAR CADASTRO
// =============================
function alterarCadastroUsuario(userId, emailAtual) {

    userIdSelecionado = userId;

    document.getElementById("edit-email").value =
        emailAtual || "";

    document.getElementById("edit-senha").value = "";

    document.getElementById("modal-editar")
        .style.display = "flex";
}

function fecharModalEditar() {

    document.getElementById("modal-editar")
        .style.display = "none";

    document.getElementById("msg-editar")
        .innerText = "";
}

async function confirmarAlteracaoCadastro() {

    const email =
        document.getElementById("edit-email")
            .value.trim();

    const senha =
        document.getElementById("edit-senha")
            .value;

    const msg =
        document.getElementById("msg-editar");

    if (!emailValido(email)) {

        msg.innerText = "Email inválido.";
        msg.style.color = "red";

        return;
    }

    if (senha && senha.length < 6) {

        msg.innerText =
            "Senha deve possuir ao menos 6 caracteres.";

        msg.style.color = "red";

        return;
    }

    try {

        const session =
            await client.auth.getSession();

        const token =
            session.data.session?.access_token;

        const res = await fetch(
            `${API_URL}/users/${userIdSelecionado}`,
            {

                method: "PUT",

                headers: {
                    "Content-Type": "application/json",
                    Authorization: `Bearer ${token}`
                },

                body: JSON.stringify({
                    email,
                    senha
                })
            }
        );

        if (res.ok) {

            msg.innerText =
                "Cadastro atualizado.";

            msg.style.color = "green";

            setTimeout(() => {

                fecharModalEditar();

                carregarUsuarios();
                carregarConfirmacoes();

            }, 1500);

        } else {

            msg.innerText =
                "Erro ao atualizar cadastro.";

            msg.style.color = "red";
        }

    } catch (err) {

        console.error(err);

        msg.innerText = "Erro inesperado.";
        msg.style.color = "red";
    }
}

// =============================
// UPLOAD PDF
// =============================
async function enviarPDF() {

    if (enviandoArquivo) return;

    enviandoArquivo = true;

    const fileInput = document.getElementById("pdf");
    const file = fileInput?.files[0];

    const msg = document.getElementById("msg");
    const loading = document.getElementById("loading");

    try {

        if (!file) {

            msg.innerText = "Selecione um PDF.";
            msg.style.color = "red";

            return;
        }

        if (file.type !== "application/pdf") {

            msg.innerText =
                "Envie apenas arquivos PDF.";

            msg.style.color = "red";

            return;
        }

        if (file.size > 10 * 1024 * 1024) {

            msg.innerText =
                "Arquivo excede 10MB.";

            msg.style.color = "red";

            return;
        }

        const formData = new FormData();

        formData.append("pdf", file);

        loading.style.display = "block";

        msg.innerText = "";

        const session =
            await client.auth.getSession();

        const token =
            session.data.session?.access_token;

        const res = await fetch("/upload", {

            method: "POST",

            headers: {
                Authorization: `Bearer ${token}`
            },

            body: formData
        });

        const data = await res.json();

        if (res.ok) {

            msg.innerText =
                "Upload realizado com sucesso.";

            msg.style.color = "green";

            fileInput.value = "";

        } else {

            msg.innerText =
                data?.erro || "Erro no upload.";

            msg.style.color = "red";
        }

    } catch (err) {

        console.error(err);

        msg.innerText =
            "Erro ao conectar ao servidor.";

        msg.style.color = "red";

    } finally {

        enviandoArquivo = false;

        if (loading) {
            loading.style.display = "none";
        }

        setTimeout(() => {

            if (msg) {
                msg.innerText = "";
            }

        }, 3000);
    }
}

async function solicitarContrachequeAnterior() {
    const ano = document.getElementById("solicitacao-ano")?.value;
    const meses = Array
        .from(document.querySelectorAll('input[name="solicitacao-mes"]:checked'))
        .map(input => input.value);
    const motivo = document.getElementById("solicitacao-motivo")?.value.trim();
    const msg = document.getElementById("msg-solicitacao");

    if (!ano || meses.length === 0) {
        msg.innerText = "Selecione o ano e pelo menos um mês.";
        msg.style.color = "red";
        return;
    }

    const referencia = `${meses.join(", ")} / ${ano}`;

    try {
        const session = await client.auth.getSession();
        const token = session.data.session?.access_token;

        const res = await fetch(`${API_URL}/solicitacoes-contracheques`, {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                Authorization: `Bearer ${token}`
            },
            body: JSON.stringify({ referencia, motivo })
        });

        const data = await res.json().catch(() => ({}));

        if (!res.ok) {
            msg.innerText = data?.erro || "Erro ao solicitar.";
            msg.style.color = "red";
            return;
        }

        msg.innerText = "Solicitação enviada.";
        msg.style.color = "green";
        document
            .querySelectorAll('input[name="solicitacao-mes"]:checked')
            .forEach(input => {
                input.checked = false;
            });
        document.getElementById("solicitacao-motivo").value = "";
        carregarSolicitacoes();

    } catch (err) {
        console.error(err);
        msg.innerText = "Erro inesperado.";
        msg.style.color = "red";
    }
}

async function carregarSolicitacoes() {
    const listaUser = document.getElementById("lista-solicitacoes-user");
    const listaAdmin = document.getElementById("lista-solicitacoes-admin");
    const loadingAdmin = document.getElementById("loading-solicitacoes-admin");
    const lista = listaAdmin || listaUser;

    if (!lista) return;

    lista.innerHTML = "";
    if (loadingAdmin) loadingAdmin.style.display = "block";

    try {
        const session = await client.auth.getSession();
        const token = session.data.session?.access_token;

        const res = await fetch(`${API_URL}/solicitacoes-contracheques`, {
            headers: { Authorization: `Bearer ${token}` }
        });

        if (!res.ok) throw new Error("Erro ao carregar solicitações");
                        


        const solicitacoes = await res.json();

        if (!solicitacoes || solicitacoes.length === 0) {
            lista.innerHTML = "<p>Nenhuma solicitação encontrada.</p>";
            return;
        }

        solicitacoes.forEach(item => {
            const div = document.createElement("div");
            div.className = "confirmacao";

            const info = document.createElement("div");
            info.className = "confirmacao-info";

            const titulo = document.createElement("strong");
            titulo.textContent = listaAdmin
                ? `${item.nome_usuario || "Sem nome"} - ${item.referencia || "Sem período"}`
                : item.referencia || "Sem período";

            const detalhe = document.createElement("span");
            detalhe.textContent = item.motivo || "Sem motivo informado";

            const status = document.createElement("small");
            status.textContent = `Status: ${item.status || "pendente"}${
                item.aprovado_por_nome ? ` por ${item.aprovado_por_nome}` : ""
            }${
                item.valido_ate ? ` | válido até ${formatarDataHora(item.valido_ate)}` : ""
            }`;

            info.appendChild(titulo);
            info.appendChild(detalhe);
            info.appendChild(status);
            div.appendChild(info);

            if (listaAdmin && item.status === "pendente") {
                const actions = document.createElement("div");
                actions.className = "actions";

                const aprovar = document.createElement("button");
                aprovar.className = "btn-password";
                aprovar.textContent = "Aprovar";
                aprovar.addEventListener("click", () => avaliarSolicitacao(item.id, "aprovado"));

                const rejeitar = document.createElement("button");
                rejeitar.className = "btn-delete";
                rejeitar.textContent = "Rejeitar";
                rejeitar.addEventListener("click", () => avaliarSolicitacao(item.id, "rejeitado"));

                actions.appendChild(aprovar);
                actions.appendChild(rejeitar);
                div.appendChild(actions);
            }

            lista.appendChild(div);
        });

    } catch (err) {
        console.error(err);
        lista.innerHTML = "Erro ao carregar solicitações.";

    } finally {
        if (loadingAdmin) loadingAdmin.style.display = "none";
    }
}

async function avaliarSolicitacao(id, status) {
    const session = await client.auth.getSession();
    const token = session.data.session?.access_token;

    const res = await fetch(`${API_URL}/solicitacoes-contracheques/${id}`, {
        method: "PUT",
        headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${token}`
        },
        body: JSON.stringify({ status })
    });

    if (!res.ok) {
        alert("Erro ao atualizar solicitação.");
        return;
    }

    carregarSolicitacoes();
}

async function enviarAtestado() {
    const input = document.getElementById("arquivo-atestado");
    const file = input?.files[0];
    const msg = document.getElementById("msg-atestado");

    if (!file) {
        msg.innerText = "Selecione um arquivo.";
        msg.style.color = "red";
        return;
    }

    try {
        const session = await client.auth.getSession();
        const token = session.data.session?.access_token;
        const formData = new FormData();
        formData.append("arquivo", file);

        const res = await fetch(`${API_URL}/atestados`, {
            method: "POST",
            headers: {
                Authorization: `Bearer ${token}`
            },
            body: formData
        });

        const data = await res.json().catch(() => ({}));

        if (!res.ok) {
            msg.innerText = data?.erro || "Erro ao enviar atestado.";
            msg.style.color = "red";
            return;
        }

        msg.innerText = data?.aviso || "Atestado enviado com sucesso.";
        msg.style.color = data?.aviso ? "#92400e" : "green";
        input.value = "";

    } catch (err) {
        console.error(err);
        msg.innerText = "Erro inesperado.";
        msg.style.color = "red";
    }
}

async function carregarAtestadosAdmin() {
    const lista = document.getElementById("lista-atestados-admin");
    const loading = document.getElementById("loading-atestados-admin");

    if (!lista) return;

    lista.innerHTML = "";
    if (loading) loading.style.display = "block";

    try {
        const session = await client.auth.getSession();
        const token = session.data.session?.access_token;

        const res = await fetch(`${API_URL}/atestados`, {
            headers: { Authorization: `Bearer ${token}` }
        });

        if (!res.ok) throw new Error("Erro ao carregar atestados");
                        

        const atestados = await res.json();

        if (!atestados || atestados.length === 0) {
            lista.innerHTML = "<p>Nenhum atestado enviado.</p>";
            return;
        }

        atestados.forEach(item => {
            const div = document.createElement("div");
            div.className = "confirmacao";

            const info = document.createElement("div");
            info.className = "confirmacao-info";

            const nome = document.createElement("strong");
            nome.textContent = item.nome_usuario || "Sem nome";

            const arquivo = document.createElement("span");
            arquivo.textContent = item.nome_arquivo || item.arquivo || "Arquivo";

            const detalhe = document.createElement("small");
            detalhe.textContent = `${formatarDataHora(item.created_at)} | ${item.status_email || "registrado"}`;

            info.appendChild(nome);
            info.appendChild(arquivo);
            info.appendChild(detalhe);
            div.appendChild(info);

            lista.appendChild(div);
        });

    } catch (err) {
        console.error(err);
        lista.innerHTML = "Erro ao carregar atestados.";

    } finally {
        if (loading) loading.style.display = "none";
    }
}

async function enviarPonto() {

    if (enviandoArquivo) return;

    enviandoArquivo = true;

    const fileInput = document.getElementById("pdf");
    const file = fileInput?.files[0];
    const msg = document.getElementById("msg");
    const loading = document.getElementById("loading");

    try {
        if (!file) {
            msg.innerText = "Selecione um PDF.";
            msg.style.color = "red";
            return;
        }

        if (file.type !== "application/pdf") {
            msg.innerText = "Envie apenas arquivos PDF.";
            msg.style.color = "red";
            return;
        }

        const formData = new FormData();
        formData.append("pdf", file);

        if (loading) loading.style.display = "block";
        msg.innerText = "";

        const session = await client.auth.getSession();
        const token = session.data.session?.access_token;

        const res = await fetch("/upload-ponto", {
            method: "POST",
            headers: {
                Authorization: `Bearer ${token}`
            },
            body: formData
        });

        const data = await res.json();

        if (res.ok) {
            msg.innerText = "Folha de ponto enviada com sucesso.";
            msg.style.color = "green";
            fileInput.value = "";
        } else {
            msg.innerText = data?.erro || "Erro no upload.";
            msg.style.color = "red";
        }

    } catch (err) {
        console.error(err);
        msg.innerText = "Erro ao conectar ao servidor.";
        msg.style.color = "red";

    } finally {
        enviandoArquivo = false;
        if (loading) loading.style.display = "none";
    }
}

// =============================
// INICIALIZAÇÃO SEGURA
// =============================
document.addEventListener(
    "DOMContentLoaded",
    async () => {
        document
            .getElementById("btn-confirmar-download")
            ?.addEventListener("click", confirmarDownload);

        const pagina =
            window.location.pathname
            .toLowerCase();

        try {

            // páginas públicas
            if (
                pagina.includes("login") ||
                pagina.includes("reset-password")
            ) {

                document.body.style.display =
                    "";

                if (pagina.includes("reset-password")) {
                    await recuperarSessao();
                }

                return;
            }

            // valida sessão
            const { data } =
                await client.auth.getUser();

            const user = data.user;

            // sem login
            if (!user) {

                window.location.href =
                    "login.html";

                return;
            }

            const tipo =
                user.user_metadata?.tipo;

            const sessaoAtiva = await iniciarControleSessao();

            if (!sessaoAtiva) return;

            // =============================
            // USER
            // =============================
            if (
                pagina.includes("user")
            ) {

               if (
                    tipo !== "user" &&
                    tipo !== "funcionario"
                ) {

                    window.location.href =
                        "login.html";

                    return;
                }

                carregarDashboard(user);
                configurarComboAnosSolicitacao();
                carregarSolicitacoes();
            }

            // =============================
            // ADMIN
            // =============================
            if (
                pagina.includes("admin")
            ) {

                if (tipo !== "admin") {

                    window.location.href =
                        "login.html";

                    return;
                }

                carregarUsuarios();
                carregarConfirmacoes();
                carregarDashboard(user);
                carregarContrachequesAdmin(user);
                carregarSolicitacoes();
                carregarAtestadosAdmin();
            }

            // =============================
            // CADASTRO
            // =============================
            if (
                pagina.includes("cadastro")
            ) {

                if (tipo !== "admin") {

                    window.location.href =
                        "login.html";

                    return;
                }
            }

            // =============================
            // UPLOAD
            // =============================
            if (
                pagina.includes("upload")
            ) {

                if (tipo !== "admin") {

                    window.location.href =
                        "login.html";

                    return;
                }
            }

            if (
                pagina.includes("confirmacoes")
            ) {

                if (tipo !== "admin") {

                    window.location.href =
                        "login.html";

                    return;
                }

                carregarConfirmacoes();
            }

            // libera página
            document.body.style.display =
                "";

        } catch (err) {

            console.error(err);

            window.location.href =
                "login.html";
        }
    }
);

// =============================
// ENTER LOGIN
// =============================
document.addEventListener("keydown", function(event) {

    if (event.key !== "Enter") return;

    const email =
        document.getElementById("email");

    const password =
        document.getElementById("password");

    if (!email || !password) return;

    fazerLogin();
});

// =============================
// ESC FECHAR MODAL
// =============================
document.addEventListener("keydown", function(event) {

    if (event.key !== "Escape") return;

    const modal =
        document.getElementById("modal-editar");

    if (
        modal &&
        modal.style.display === "flex"
    ) {
        fecharModalEditar();
    }

    const modalTermos =
        document.getElementById("modal-termos");

    if (
        modalTermos &&
        modalTermos.style.display === "flex"
    ) {
        fecharModalTermos();
    }
});

// ===========================================
// CARREGAR CONTRACHEQUES DO ADMIN
// ===========================================
async function carregarContrachequesAdmin(user) {

    const lista =
        document.getElementById(
            "lista-arquivos-admin"
        );

    const loading =
        document.getElementById(
            "loading-admin"
        );

    if (!lista) return;

    // loading seguro
    if (loading) {
        loading.style.display = "block";
    }

    lista.innerHTML = "";

    try {

        const nomeUsuario =
            user.user_metadata?.full_name || "";

        const nomeNormalizado =
            nomeUsuario
                .normalize("NFD")
                .replace(
                    /[\u0300-\u036f]/g,
                    ""
                )
                .toUpperCase()
                .trim();

        let arquivosEncontrados = [];

        // =============================
        // LISTA PASTAS
        // =============================
        const {
            data: pastas,
            error: erroPastas
        } = await client.storage
            .from("contracheques")
            .list("", {
                limit: 100
            });

        if (erroPastas) {

            console.error(
                "ERRO STORAGE:",
                erroPastas
            );

            lista.innerHTML =
                "Erro ao acessar storage.";

            return;
        }

        // =============================
        // PERCORRE PASTAS
        // =============================
        for (const pasta of pastas) {

            const {
                data: arquivos,
                error: erroArquivos
            } = await client.storage
                .from("contracheques")
                .list(pasta.name, {
                    limit: 100
                });

            if (erroArquivos) {

                console.error(
                    "ERRO ARQUIVOS:",
                    erroArquivos
                );

                continue;
            }

            if (!arquivos) continue;

            arquivos.forEach(file => {

                const nomeArquivo =
                    file.name
                        .normalize("NFD")
                        .replace(
                            /[\u0300-\u036f]/g,
                            ""
                        )
                        .toUpperCase()
                        .trim();

                // ADMIN vê apenas os próprios
                if (
                    nomeArquivo.includes(
                        nomeNormalizado
                    )
                ) {

                    arquivosEncontrados.push({
                        nome: file.name,
                        caminho:
                            `${pasta.name}/${file.name}`
                    });
                }
            });
        }

        // =============================
        // SEM ARQUIVOS
        // =============================
        if (
            arquivosEncontrados.length === 0
        ) {

            lista.innerHTML =
                "Nenhum contracheque encontrado.";

            return;
        }

        // =============================
        // RENDERIZA
        // =============================
        arquivosEncontrados.forEach(file => {

            const div =
                document.createElement("div");

            div.className =
                "documento";

            // evita innerHTML inseguro
            const span =
                document.createElement("span");

            span.textContent =
                file.nome;

            const botao =
                document.createElement("button");

            botao.className =
                "btn-download";

            botao.textContent =
                "Baixar";

            botao.addEventListener(
                "click",
                () => {
                    baixarArquivo(
                        file.caminho
                    );
                }
            );

            div.appendChild(span);
            div.appendChild(botao);

            lista.appendChild(div);
        });

    } catch (err) {

        console.error(
            "ERRO GERAL:",
            err
        );

        lista.innerHTML =
            "Erro inesperado.";

    } finally {

        if (loading) {
            loading.style.display =
                "none";
        }
    }
}
