// =============================
// CARREGAR USUÁRIOS
// =============================
async function carregarUsuarios() {
    const lista = document.getElementById("lista-usuarios");
    const loading = document.getElementById("loading-usuarios");

    if (!lista || !loading) return;

    lista.innerHTML = "";
    loading.style.display = "block";

    try {
        const res = await fetch(`${API_URL}/users`, {
            headers: { "Authorization": "admin123" }
        });

        const usuarios = await res.json();

        console.log("USUÁRIOS:", usuarios); // ← IMPORTANTE

        loading.style.display = "none";

        if (!usuarios || usuarios.length === 0) {
            lista.innerHTML = "<p>Nenhum usuário encontrado.</p>";
            return;
        }

        lista.innerHTML = "";

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
        loading.style.display = "none";
        lista.innerHTML = "Erro ao carregar usuários.";
        console.error(err);
    }
}

// =============================
// INICIALIZAÇÃO
// =============================
carregarUsuarios();