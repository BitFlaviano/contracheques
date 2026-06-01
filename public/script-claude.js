// =============================
// UPLOAD UNIFICADO COM CLAUDE
// =============================

let arquivosSelecionados = [];

const uploadZone = document.getElementById('uploadZone');
const pdfInput = document.getElementById('pdfInput');
const fileList = document.getElementById('fileList');
const filesContainer = document.getElementById('filesContainer');
const loading = document.getElementById('loading');
const resultados = document.getElementById('resultados');
const resultadosList = document.getElementById('resultadosList');
const msg = document.getElementById('msg');
const btnEnviar = document.getElementById('btnEnviar');
const btnLimpar = document.getElementById('btnLimpar');

// =============================
// EVENTOS DRAG & DROP
// =============================

uploadZone.addEventListener('click', () => pdfInput.click());

uploadZone.addEventListener('dragover', (e) => {
    e.preventDefault();
    uploadZone.classList.add('dragover');
});

uploadZone.addEventListener('dragleave', () => {
    uploadZone.classList.remove('dragover');
});

uploadZone.addEventListener('drop', (e) => {
    e.preventDefault();
    uploadZone.classList.remove('dragover');
    
    const files = e.dataTransfer.files;
    selecionarArquivos(files);
});

pdfInput.addEventListener('change', (e) => {
    selecionarArquivos(e.target.files);
});

// =============================
// SELECIONAR ARQUIVOS
// =============================

function selecionarArquivos(files) {
    arquivosSelecionados = Array.from(files).filter(file => file.type === 'application/pdf');

    if (arquivosSelecionados.length === 0) {
        msg.innerText = '❌ Selecione apenas arquivos PDF';
        msg.style.color = 'red';
        return;
    }

    msg.innerText = '';
    renderizarArquivos();
    btnEnviar.style.display = 'inline-block';
    btnLimpar.style.display = 'inline-block';
}

function renderizarArquivos() {
    filesContainer.innerHTML = '';
    fileList.style.display = 'block';

    arquivosSelecionados.forEach((file, index) => {
        const fileItem = document.createElement('div');
        fileItem.className = 'file-item';
        fileItem.innerHTML = `
            <div class="file-info">
                <div class="file-name">📄 ${file.name}</div>
                <div class="file-size">${(file.size / 1024).toFixed(2)} KB</div>
            </div>
            <button class="file-remove" onclick="removerArquivo(${index})">Remover</button>
        `;
        filesContainer.appendChild(fileItem);
    });
}

function removerArquivo(index) {
    arquivosSelecionados.splice(index, 1);
    
    if (arquivosSelecionados.length === 0) {
        fileList.style.display = 'none';
        btnEnviar.style.display = 'none';
        btnLimpar.style.display = 'none';
    } else {
        renderizarArquivos();
    }
}

function limparSeleção() {
    arquivosSelecionados = [];
    pdfInput.value = '';
    fileList.style.display = 'none';
    resultados.style.display = 'none';
    btnEnviar.style.display = 'none';
    btnLimpar.style.display = 'none';
    msg.innerText = '';
}

// =============================
// ENVIAR DOCUMENTOS
// =============================

async function enviarDocumentos() {
    if (arquivosSelecionados.length === 0) {
        msg.innerText = '❌ Selecione pelo menos um arquivo';
        msg.style.color = 'red';
        return;
    }

    loading.style.display = 'block';
    msg.innerText = '';
    resultados.style.display = 'none';

    try {
        const session = await client.auth.getSession();
        const token = session.data.session?.access_token;

        if (!token) {
            window.location.href = 'login.html';
            return;
        }

        const formData = new FormData();
        arquivosSelecionados.forEach((file) => {
            formData.append('pdfs', file);
        });

        const res = await fetch('/upload-unificado', {
            method: 'POST',
            headers: {
                Authorization: `Bearer ${token}`,
            },
            body: formData,
        });

        const data = await res.json();

        if (!res.ok) {
            throw new Error(data.erro || 'Erro ao enviar documentos');
        }

        // Exibir resultados
        exibirResultados(data.documentos);
        msg.innerText = '✅ Documentos processados com sucesso!';
        msg.style.color = 'green';

        // Limpar após 2 segundos
        setTimeout(() => {
            limparSeleção();
        }, 3000);

    } catch (err) {
        console.error(err);
        msg.innerText = `❌ ${err.message}`;
        msg.style.color = 'red';
    } finally {
        loading.style.display = 'none';
    }
}

function exibirResultados(documentos) {
    resultadosList.innerHTML = '';
    resultados.style.display = 'block';

    documentos.forEach((doc, index) => {
        const classe = doc.confianca > 0.7 ? 'resultado-item' : 
                       doc.confianca > 0.4 ? 'resultado-item warning' : 
                       'resultado-item error';

        const tipoEmoji = {
            'contracheque': '💰',
            'comprovante': '📋',
            'folha-ponto': '⏱️',
        }[doc.tipo] || '📄';

        const classTipo = {
            'contracheque': 'resultado-tipo',
            'comprovante': 'resultado-tipo comprovante',
            'folha-ponto': 'resultado-tipo folha-ponto',
        }[doc.tipo] || 'resultado-tipo';

        const confiancaPercent = (doc.confianca * 100).toFixed(0);

        const item = document.createElement('div');
        item.className = classe;
        item.innerHTML = `
            <div class="resultado-header">
                <span class="${classTipo}">${tipoEmoji} ${doc.tipo.toUpperCase()}</span>
                <span class="resultado-confianca">Confiança: ${confiancaPercent}%</span>
            </div>
            <div class="resultado-detail">
                <strong>Nome:</strong> <span>${doc.nome}</span>
            </div>
            <div class="resultado-detail">
                <strong>Período:</strong> <span>${doc.periodo}</span>
            </div>
            <div class="resultado-detail">
                <strong>Arquivo:</strong> <span>${doc.nomeArquivo}</span>
            </div>
            ${doc.observacoes ? `<div class="resultado-detail"><strong>Obs:</strong> <span>${doc.observacoes}</span></div>` : ''}
        `;
        resultadosList.appendChild(item);
    });
}

// =============================
// INICIALIZAÇÃO
// =============================

document.addEventListener('DOMContentLoaded', async () => {
    try {
        const { data } = await client.auth.getUser();
        const user = data.user;

        if (!user) {
            window.location.href = 'login.html';
            return;
        }

        // Apenas admin pode fazer upload
        if (user.user_metadata?.tipo !== 'admin') {
            window.location.href = 'login.html';
            return;
        }

        document.body.style.display = '';
    } catch (err) {
        console.error(err);
        window.location.href = 'login.html';
    }
});
