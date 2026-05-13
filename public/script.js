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

    const email = document.getElementById('email')?.value.trim();
    const password = document.getElementById('password')?.value;
    const erroDisplay = document.getElementById('mensagem-erro');

    if (erroDisplay) {
        erroDisplay.innerText = "";
    }

    try {

        if (!email || !password) {

            if (erroDisplay) {
                erroDisplay.innerText = "Preencha email e senha.";
            }

            return;
        }

        const { data, error } =
            await client.auth.signInWithPassword({
                email,
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

        if (tipo === 'admin') {
            window.location.href = 'admin.html';
        } else {
            window.location.href = 'user.html';
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

// =============================
// LOGOUT
// =============================
async function fazerLogout() {

    await client.auth.signOut();

    window.location.href = 'login.html';
}

// =============================
// DASHBOARD USUÁRIO
// =============================
async function carregarDashboard(user) {

    const lista = document.getElementById('lista-arquivos');
    const loadingUser = document.getElementById('loading-user');
    const btn = document.getElementById('btn-refresh');
    const nomeSpan = document.getElementById("nome-usuario");

    if (nomeSpan) {
        nomeSpan.innerText =
            user.user_metadata?.full_name || "Colaborador";
    }

    if (lista) lista.innerHTML = "";
    if (loadingUser) loadingUser.style.display = "block";
    if (btn) btn.style.display = "none";

    try {

        const nomeUsuario =
            user.user_metadata?.full_name || "Colaborador";

        const nomeNormalizado =
            normalizarTexto(nomeUsuario);

        let arquivosEncontrados = [];

        const { data: pastas, error } =
            await client.storage
                .from('contracheques')
                .list('', { limit: 100 });

        if (error) {

            if (lista) {
                lista.innerText = "Erro ao buscar arquivos.";
            }

            return;
        }

        for (const pasta of pastas) {

            const { data: arquivos } =
                await client.storage
                    .from('contracheques')
                    .list(pasta.name, { limit: 100 });

            if (!arquivos) continue;

            arquivos.forEach(file => {

                const nomeArquivo =
                    normalizarTexto(file.name);

                if (nomeArquivo.includes(nomeNormalizado)) {

                    arquivosEncontrados.push({
                        nome: file.name,
                        caminho: `${pasta.name}/${file.name}`
                    });
                }
            });
        }

        if (!lista) return;

        if (arquivosEncontrados.length === 0) {

            lista.innerText =
                "Nenhum contracheque encontrado.";

            return;
        }

        lista.innerHTML = "";

        arquivosEncontrados.forEach(file => {

            const div = document.createElement('div');
            div.className = "documento";

            const span = document.createElement('span');
            span.innerText = file.nome;

            const button = document.createElement('button');
            button.className = "btn-download";
            button.innerText = "Baixar";

            button.addEventListener('click', () => {
                baixarArquivo(file.caminho);
            });

            div.appendChild(span);
            div.appendChild(button);

            lista.appendChild(div);
        });

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

// =============================
// BAIXAR ARQUIVO
// =============================
async function baixarArquivo(caminho) {

    const { data, error } =
        await client.storage
            .from('contracheques')
            .download(caminho);

    if (error) {

        alert("Erro ao baixar arquivo.");
        console.error(error);

        return;
    }

    const url = URL.createObjectURL(data);

    const a = document.createElement('a');

    a.href = url;
    a.download = caminho.split('/').pop();

    document.body.appendChild(a);

    a.click();

    document.body.removeChild(a);

    URL.revokeObjectURL(url);
}

// =============================
// CADASTRAR USUÁRIO
// =============================
async function cadastrar() {

    const nome = document.getElementById("nome")?.value.trim();
    const email = document.getElementById("email")?.value.trim();
    const senha = document.getElementById("senha")?.value;
    const cpf = document.getElementById("cpf")?.value.trim();
    const tipo = document.getElementById("tipo")?.value;
    const msg = document.getElementById("msg");

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
                cpf,
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

// =============================
// INICIALIZAÇÃO
// =============================
document.addEventListener(
    "DOMContentLoaded",
    async () => {

        const pagina =
            window.location.pathname;

        if (pagina.includes("login.html")) {
            return;
        }

        const { data } =
            await client.auth.getUser();

        if (!data.user) {

            window.location.href =
                "login.html";

            return;
        }

        const user = data.user;
        const tipo = user.user_metadata?.tipo;

        // USER
        if (pagina.includes("user.html")) {

            if (tipo !== "user") {

                window.location.href =
                    "admin.html";

                return;
            }

            carregarDashboard(user);

            return;
        }

        // ADMIN
        if (pagina.includes("admin.html")) {

            if (tipo !== "admin") {

                window.location.href =
                    "user.html";

                return;
            }

            const nomeUsuario =
                document.getElementById(
                    "nome-usuario"
                );

            if (nomeUsuario) {

                nomeUsuario.innerText =
                    user.user_metadata?.full_name ||
                    "Administrador";
            }

            carregarUsuarios();

            return;
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
});