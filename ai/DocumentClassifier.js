async function classificarDocumento(gemini, base64, mediaType) {

    const response =
        await gemini.models.generateContent({
            model: "gemini-2.0-flash",
            contents: [
                {
                    inlineData: {
                        mimeType: mediaType,
                        data: base64
                    }
                },
                {
                    text:
                        "Classifique este documento brasileiro. Responda APENAS com uma palavra: contracheque, folha-ponto, comprovante ou desconhecido."
                }
            ]
        });

    const resposta =
        response.text
            ?.toLowerCase()
            ?.trim() || "";

    if (resposta.includes("contracheque"))
        return "contracheque";

    if (
        resposta.includes("folha-ponto") ||
        resposta.includes("folha de ponto")
    )
        return "folha-ponto";

    if (resposta.includes("comprovante"))
        return "comprovante";

    return "desconhecido";
}

module.exports = { classificarDocumento };