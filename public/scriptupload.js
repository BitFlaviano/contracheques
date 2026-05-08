async function enviarPDF() {
    const fileInput = document.getElementById("pdf");
    const file = fileInput.files[0];
    const msg = document.getElementById("msg");
    const loading = document.getElementById("loading");

    console.log("INICIOU FUNÇÃO");

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


