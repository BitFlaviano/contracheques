const MODEL =
    process.env.GEMINI_MODEL ||
    'gemini-1.5-flash';

const PROMPTS = {
    contracheque: `Analise este contracheque brasileiro e extraia os dados. Retorne APENAS JSON válido.`,
    'folha-ponto': `Analise esta folha de ponto e retorne APENAS JSON válido.`,
    ponto: `Analise este folha de ponto e retorne APENAS JSON válido.`,
    comprovante: `Analise este comprovante e retorne APENAS JSON válido.`
    
};

async function extrairDados(
    gemini,
    base64,
    mediaType,
    tipoDocumento
) {
    const prompt = PROMPTS[tipoDocumento];

    const response =
        await gemini.models.generateContent({
            model: MODEL,
            contents: [
                {
                    inlineData: {
                        mimeType: mediaType,
                        data: base64
                    }
                },
                {
                    text: prompt
                }
            ]
        });

    let texto =
        response.text?.trim() || '{}';

    texto = texto
        .replace(/```json/g, '')
        .replace(/```/g, '')
        .trim();

    try {
        return JSON.parse(texto);
    } catch (err) {
        console.log(
            'Resposta Gemini:',
            texto
        );

        throw new Error(
            'JSON inválido retornado pela IA'
        );
    }
}

module.exports = {
    extrairDados
};