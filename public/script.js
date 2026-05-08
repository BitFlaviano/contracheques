// =============================
// CONFIGURAÇÃO SUPABASE
// =============================
const SUPABASE_URL = 'https://uatryxvylqwslnaxggjk.supabase.co';
//  Use APENAS a chave anon/public aqui, nunca a service_role!
const SUPABASE_KEY = 'sb_publishable_hIM2Rl5P2BtJHRmLg7qzHQ_dM6tJoxj';
const client = supabase.createClient(SUPABASE_URL, SUPABASE_KEY);

const API_URL = "";
let userIdSelecionado = null;
let saindo = false;
// =============================
// LOGIN E REDIRECIONAMENTO
// =============================
async function fazerLogin() {

    const email = document.getElementById('email').value;
    const password = document.getElementById('password').value;
    const erroDisplay = document.getElementById('mensagem-erro');

    const { data, error } = await client.auth.signInWithPassword({ email, password });

    if (error) {
        erroDisplay.innerText = "Erro: " + error.message;
        return;
    }

    const user = data.user;
    const tipo = user.user_metadata?.tipo;

    if (tipo === 'admin') {
        window.location.href = 'admin.html';
    } else { window.location.href = 'user.html';
        
    }
}

// ------------------------------------
// LOGOUT
// ------------------------------------
async function fazerLogout() {
    saindo = true;
    await client.auth.signOut();
    window.location.href = 'login.html';
}

// ------------------------------------
// DASHBOARD DO COLABORADOR
// ------------------------------------

async function carregarDashboard(user) {
    document.getElementById('login-section')?.classList.add('hidden');
    document.getElementById('dashboard-section')?.classList.remove('hidden');

    const nomeUsuario = user.user_metadata?.full_name || "Colaborador";
    document.getElementById('nome-usuario').innerText = nomeUsuario;

    const lista = document.getElementById('lista-arquivos');
    lista.innerHTML = "Buscando seus arquivos...";

    // normalização (igual ao servidor)
    const nomeNormalizado = nomeUsuario
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "")
        .toUpperCase();

    let arquivosEncontrados = [];

    // 1. listar todas as pastas (timestamps)
    const { data: pastas, error: erroPastas } = await client.storage
        .from('contracheques')
        .list('', { limit: 100 });

    if (erroPastas) {
        lista.innerHTML = "Erro ao acessar storage.";
        console.error(erroPastas);
        return;
    }

    // 2. percorrer cada pasta
    for (let pasta of pastas) {

        const { data: arquivos } = await client.storage
            .from('contracheques')
            .list(pasta.name, { limit: 100 });

        if (!arquivos) continue;

        // 3. filtrar arquivos do usuário
        arquivos.forEach(file => {

            const nomeArquivoNormalizado = file.name
                .normalize("NFD")
                .replace(/[\u0300-\u036f]/g, "")
                .toUpperCase();

            if (nomeArquivoNormalizado.includes(nomeNormalizado)) {
                arquivosEncontrados.push({
                    nome: file.name,
                    caminho: `${pasta.name}/${file.name}`
                });
            }
        });
    }

    // 4. exibir resultado
    if (arquivosEncontrados.length === 0) {

    if (loadingUser) {
        loadingUser.style.display = "none";
    }

    if (btn) {
        btn.style.display = "flex";
    }

    lista.innerHTML = "Nenhum contracheque encontrado.";
    return;
    }

    lista.innerHTML = "";

    arquivosEncontrados.forEach(file => {
        const div = document.createElement('div');
        div.className = "documento";

        div.innerHTML = `
            <span>${file.nome}</span>
            <button class="btn-download" onclick="baixarArquivo('${file.caminho}')">
                Baixar
            </button>
        `;

        lista.appendChild(div);
    });
}

// =============================
// BAIXAR ARQUIVO
// =============================
async function baixarArquivo(caminho) {
    const { data, error } = await client.storage
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
    a.click();
    URL.revokeObjectURL(url);
}

// =============================
// CADASTRO DE USUÁRIO (ADMIN)
// =============================
async function cadastrar() {
    const nome = document.getElementById("nome").value;
    const email = document.getElementById("email").value;
    const senha = document.getElementById("senha").value;
    const cpf = document.getElementById("cpf").value;
    const tipo = document.getElementById("tipo").value;
    const msg = document.getElementById("msg");

    try {
        const res = await fetch(`${API_URL}/register`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ nome, email, senha, cpf, tipo })
        });
        const data = await res.json();
        if (res.ok) {

            msg.innerText = "Usuário cadastrado com sucesso!";
            msg.style.color = "green";

            // limpa campos
            document.getElementById("nome").value = "";
            document.getElementById("email").value = "";
            document.getElementById("senha").value = "";
            document.getElementById("cpf").value = "";
            document.getElementById("tipo").value = "user";

        } else {

            msg.innerText = "Erro: " + data.erro;
            msg.style.color = "red";
        }
        
    } catch (err) {
        msg.innerText = "Erro ao conectar ao servidor.";
        console.error(err);
    }
}

// =============================
// CARREGAR USUÁRIOS (ADMIN)
// =============================
async function carregarUsuarios() {
    const lista = document.getElementById("lista-usuarios");
    if (!lista) return;

    lista.innerHTML = "Carregando usuários...";

    try {
        const res = await fetch(`${API_URL}/users`, {
            headers: { "Authorization": "admin123" }
        });

        if (!res.ok) {
            lista.innerHTML = "Erro ao carregar usuários.";
            return;
        }

        const usuarios = await res.json();
        lista.innerHTML = "";

        if (!usuarios.length) {
            lista.innerHTML = "<p>Nenhum usuário encontrado.</p>";
            return;
        }

        usuarios.forEach(user => {
        const div = document.createElement("div");
        div.className = "user";

        const nome = user.user_metadata?.full_name || "Sem nome";

            div.innerHTML = `
                <div class="user-info">
                    <strong>${nome}</strong>
                    <span>${user.email}</span>
                </div>

                <div class="actions">
                    <button class="btn-password">Alterar Cadastro</button>
                    <button class="btn-delete">Excluir</button>
                </div>
    `;

    const btnAlterar = div.querySelector('.btn-password');
    const btnExcluir = div.querySelector('.btn-delete');

    btnAlterar.addEventListener('click', () => {
        alterarCadastroUsuario(user.id, user.email);
    });

    btnExcluir.addEventListener('click', () => {
        deletarUsuario(user.id);
    });

    lista.appendChild(div);
});

    } catch (err) {
        lista.innerHTML = "Erro ao conectar ao servidor.";
        console.error(err);
    }
}

// =============================
// EXCLUIR USUÁRIO (ADMIN)
// =============================
async function deletarUsuario(userId) {
    if (!confirm("Deseja excluir este usuário?")) return;

    const res = await fetch(`${API_URL}/users/${userId}`, {
        method: "DELETE",
        headers: { "Authorization": "admin123" }
    });

    if (res.ok) {
        alert("Usuário excluído!");
        carregarUsuarios();
    } else {
        alert("Erro ao excluir usuário.");
    }
}

// =============================
// MODAL ALTERAR SENHA (ADMIN)
// =============================
function alterarSenhaUsuario(userId) {
    userIdSelecionado = userId;
    document.getElementById("modal-senha").style.display = "flex";
}

function fecharModalSenha() {
    document.getElementById("modal-senha").style.display = "none";
    document.getElementById("nova-senha").value = "";
    document.getElementById("confirmar-senha").value = "";
    document.getElementById("msg-senha").innerText = "";
}

async function confirmarAlteracaoSenha() {
    const novaSenha = document.getElementById("nova-senha").value;
    const confirmar = document.getElementById("confirmar-senha").value;
    const msg = document.getElementById("msg-senha");

    if (!novaSenha || novaSenha.length < 6) {
        msg.innerText = "A senha deve ter pelo menos 6 caracteres.";
        msg.style.color = "red";
        return;
    }

    if (novaSenha !== confirmar) {
        msg.innerText = "As senhas não coincidem.";
        msg.style.color = "red";
        return;
    }

    const res = await fetch(`${API_URL}/users/${userIdSelecionado}/password`, {
        method: "PUT",
        headers: {
            "Content-Type": "application/json",
            "Authorization": "admin123"
        },
        body: JSON.stringify({ novaSenha })
    });

    if (res.ok) {
        msg.innerText = "Senha alterada com sucesso!";
        msg.style.color = "green";
        setTimeout(() => fecharModalSenha(), 1500);
    } else {
        msg.innerText = "Erro ao alterar senha.";
        msg.style.color = "red";
    }
}

// =============================
// NAVEGAÇÃO
// =============================
function irCadastro() {
    window.location.href = "cadastro.html";
}

function irUpload() {
    window.location.href = "upload.html";
}

// ----------------------------------
// MODAL ALTERAR CADASTRO (ADMIN)
// ----------------------------------
function alterarCadastroUsuario(userId, emailAtual) {
    userIdSelecionado = userId;

    document.getElementById("edit-email").value = emailAtual || "";
    document.getElementById("edit-senha").value = "";

    document.getElementById("modal-editar").style.display = "flex";
}
//-----------------------------------
// FECHAR MODAL
//-----------------------------------

function fecharModalEditar() {
    document.getElementById("modal-editar").style.display = "none";
    document.getElementById("msg-editar").innerText = "";
}

//-----------------------------------
//   CONFIRMAÇÃO DE ALTERAÇÃO DE CADASTRO
//-----------------------------------

async function confirmarAlteracaoCadastro() {
    const email = document.getElementById("edit-email").value;
    const senha = document.getElementById("edit-senha").value;
    const msg = document.getElementById("msg-editar");

    if (!email) {
        msg.innerText = "Email é obrigatório.";
        msg.style.color = "red";
        return;
    }

    if (senha && senha.length < 6) {
        msg.innerText = "Senha deve ter pelo menos 6 caracteres.";
        msg.style.color = "red";
        return;
    }

    const res = await fetch(`${API_URL}/users/${userIdSelecionado}`, {
        method: "PUT",
        headers: {
            "Content-Type": "application/json",
            "Authorization": "admin123"
        },
        body: JSON.stringify({ email, senha })
    });

    if (res.ok) {
        msg.innerText = "Cadastro atualizado!";
        msg.style.color = "green";

        setTimeout(() => {
            fecharModalEditar();
            carregarUsuarios();
        }, 1500);

    } else {
        msg.innerText = "Erro ao atualizar.";
        msg.style.color = "red";
    }
}

document.addEventListener("keydown", function(event) {
    if (event.key === "Escape") {
        const modal = document.getElementById("modal-editar");

        if (modal && modal.style.display === "flex") {
            fecharModalEditar();
        }
    }
});



//-------------------------------------------
// CARREGAR CONTRACHEQUES DO ADMIN
//-------------------------------------------
async function carregarContrachequesAdmin(user) {
    const lista = document.getElementById('lista-arquivos-admin');
    const loading = document.getElementById('loading-admin');

    if (!lista || !loading) return;

    lista.innerHTML = "";
    loading.style.display = "block";

    // força render antes de processar
    await new Promise(r => setTimeout(r, 50));

    const nomeUsuario = user.user_metadata?.full_name || "";

    const nomeNormalizado = nomeUsuario
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "")
        .toUpperCase();

    let arquivosEncontrados = [];

    const { data: pastas, error } = await client.storage
        .from('contracheques')
        .list('', { limit: 100 });

    if (error) {
        loading.style.display = "none";
        lista.innerHTML = "Erro ao acessar storage.";
        return;
    }

    for (let pasta of pastas) {
        const { data: arquivos } = await client.storage
            .from('contracheques')
            .list(pasta.name, { limit: 100 });

        if (!arquivos) continue;

        arquivos.forEach(file => {
            const nomeArquivo = file.name
                .normalize("NFD")
                .replace(/[\u0300-\u036f]/g, "")
                .toUpperCase();

            if (nomeArquivo.includes(nomeNormalizado)) {
                arquivosEncontrados.push({
                    nome: file.name,
                    caminho: `${pasta.name}/${file.name}`
                });
            }
        });
    }

    loading.style.display = "none";

    if (arquivosEncontrados.length === 0) {
        lista.innerHTML = "Nenhum contracheque encontrado.";
        return;
    }

    arquivosEncontrados.forEach(file => {
        const div = document.createElement('div');
        div.className = "documento";

        div.innerHTML = `
            <span>${file.nome}</span>
            <button class="btn-download" onclick="baixarArquivo('${file.caminho}')">
                Baixar
            </button>
        `;

        lista.appendChild(div);
    });

    if (arquivosEncontrados.length === 0) {

    loading.style.display = "none";

    lista.innerHTML = "Nenhum contracheque encontrado.";
    return;
    }

    if (arquivosEncontrados.length === 0) {

    loading.style.display = "none";

    lista.innerHTML = "Nenhum contracheque encontrado.";
    return;
}
}


//-----------------------------------------
// VALIDA SE È ADMIN
//-----------------------------------------

async function iniciarAdmin() {
    const { data: { user } } = await client.auth.getUser();

    if (user) {
        carregarContrachequesAdmin(user);
    }
}

//------------------------------------------
// ENVIAR
//------------------------------------------

async function enviarPDF() {
    const fileInput = document.getElementById("pdf");
    const file = fileInput.files[0];
    const msg = document.getElementById("msg");
    const loading = document.getElementById("loading");

    

    if (!file) {
        msg.innerText = "Selecione um arquivo.";
        msg.style.color = "red";
        return;
    }

    const formData = new FormData();
    formData.append("pdf", file);

    // mostra loading
    loading.style.display = "block";
    msg.innerText = "";

    // força renderização visual
    await new Promise(resolve => setTimeout(resolve, 100));

    try {
        const res = await fetch("/upload", {
            method: "POST",
            body: formData
        });

        console.log("RESPOSTA RECEBIDA:", res.status);

        let data = null;
        try {
            data = await res.json();
        } catch (e) {
            console.log("Resposta não é JSON");
        }

        if (res.ok) {
            msg.innerText = "Upload realizado com sucesso!";
            msg.style.color = "green";
            fileInput.value = "";
        } else {
            msg.innerText = data?.erro || "Erro no processamento.";
            msg.style.color = "red";
        }

        } catch (err) {
            console.error("ERRO FETCH:", err);
            msg.innerText = "Erro ao conectar com o servidor.";
            msg.style.color = "red";
        } finally {
            // sempre executa
            loading.style.display = "none";
        }

        // limpa mensagem depois de alguns segundos
        setTimeout(() => {
            msg.innerText = "";
        }, 3000);
}

async function carregarDashboard(user) {

    console.log("INICIO DASHBOARD");
    console.log("USER:", user);
    console.log("NOME:", user.user_metadata);
    
    const lista = document.getElementById('lista-arquivos');
    const loadingUser = document.getElementById('loading-user');
    const btn = document.getElementById('btn-refresh');

    // controle visual (seguro)
    if (lista) lista.innerHTML = "";
    if (loadingUser) loadingUser.style.display = "block";
    if (btn) btn.style.display = "none";

    try {

        const nomeUsuario = user.user_metadata?.full_name || "Colaborador";

        const nomeNormalizado = nomeUsuario
            .normalize("NFD")
            .replace(/[\u0300-\u036f]/g, "")
            .toUpperCase();

        let arquivosEncontrados = [];

        const { data: pastas, error } = await client.storage
            .from('contracheques')
            .list('', { limit: 100 });

        if (error) {
            console.error("ERRO STORAGE:", error);
            if (lista) lista.innerHTML = "Erro ao buscar arquivos.";
            return;
        }

        for (let pasta of pastas) {

            const { data: arquivos } = await client.storage
                .from('contracheques')
                .list(pasta.name, { limit: 100 });

            if (!arquivos) continue;

            arquivos.forEach(file => {

                const nomeArquivo = file.name
                    .normalize("NFD")
                    .replace(/[\u0300-\u036f]/g, "")
                    .toUpperCase();

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
            lista.innerHTML = "Nenhum contracheque encontrado.";
            return;
        }

        lista.innerHTML = "";

        arquivosEncontrados.forEach(file => {
            const div = document.createElement('div');
            div.className = "documento";

            div.innerHTML = `
                <span>${file.nome}</span>
                <button class="btn-download" onclick="baixarArquivo('${file.caminho}')">
                    Baixar
                </button>
            `;

            lista.appendChild(div);
        });

    } catch (err) {
        console.error("ERRO GERAL:", err);
        if (lista) lista.innerHTML = "Erro inesperado.";
    }

    // FINAL (sempre executa)
    if (loadingUser) loadingUser.style.display = "none";
    if (btn) btn.style.display = "flex";

    const nomeSpan = document.getElementById("nome-usuario");

    if (nomeSpan) {
        nomeSpan.innerText = user.user_metadata?.full_name || "Colaborador";
    }

    
    console.log("FIM DASHBOARD");
}

// window.addEventListener("DOMContentLoaded", async () => {

//     const { data } = await client.auth.getUser();

//     if (!data.user) {
//         window.location.href = "login.html";
//         return;
//     }

//     const user = data.user;

//     // 🔥 agora funciona com DOM carregado
//     carregarDashboard(user);
// });

//------------------------------
//   CARREGAR NOME DO USUARIO
//------------------------------
 async function iniciarUsuario() {
            const { data } = await client.auth.getUser();

            if (!data.user) {
                window.location.href = "login.html";
                return;
            }

            const user = data.user;

            document.getElementById("nome-usuario").innerText =
                user.user_metadata?.full_name || "Colaborador";

            carregarDashboard(user);
        }

// =============================
// INICIALIZAÇÃO POR PÁGINA
// =============================
document.addEventListener("DOMContentLoaded", async () => {

    const pagina = window.location.pathname;

    // LOGIN
    if (pagina.includes("login.html")) {
        return;
    }

    // USER
    if (pagina.includes("user.html")) {
        iniciarUsuario();
        return;
    }

    // ADMIN
    if (pagina.includes("admin.html")) {

        const { data } = await client.auth.getUser();

        if (!data.user) {
            window.location.href = "login.html";
            return;
        }

        document.getElementById("nome-usuario").innerText =
            data.user.user_metadata?.full_name || "Administrador";

        carregarContrachequesAdmin(data.user);
        carregarUsuarios();

        return;
    }

});        

document.addEventListener("keydown", function(event) {

    if (event.key !== "Enter") return;

    const email = document.getElementById("email");
    const password = document.getElementById("password");

    // só executa na tela login
    if (!email || !password) return;

    fazerLogin();
});