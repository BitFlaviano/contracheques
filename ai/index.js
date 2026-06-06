const { classificarDocumento } = require('./DocumentClassifier');
const { extrairDados } = require('./DocumentExtractor');
const { validar } = require('./ValidationService');
const { calcularConfianca } = require('./ConfidenceAnalyzer');
const { adicionarNaFila } = require('./ReviewQueue');

async function processarDocumento(gemini, supabaseAdmin, { fileBuffer, mediaType }) {

    const base64 =
        Buffer.from(fileBuffer)
        .toString('base64');

    const tipo =
        await classificarDocumento(
            gemini,
            base64,
            mediaType
        );

    if (tipo === 'desconhecido') {
        return {
            sucesso: false,
            erro: 'Tipo de documento não reconhecido pela IA'
        };
    }

    const extracao =
        await extrairDados(
            gemini,
            base64,
            mediaType,
            tipo
        );

    const { valido, erros } =
        validar(extracao, tipo);

    const confianca =
        calcularConfianca(
            extracao,
            tipo
        );

    return {
        sucesso: true,
        tipo,
        dados: extracao,
        validacao: {
            valido,
            erros
        },
        confianca
    };
}

async function processarESalvarNaFila(
    gemini,
    supabaseAdmin,
    {
        fileBuffer,
        mediaType,
        caminho,
        bucket
    }
) {

    const resultado =
        await processarDocumento(
            gemini,
            supabaseAdmin,
            {
                fileBuffer,
                mediaType
            }
        );

    if (!resultado.sucesso)
        return resultado;
    const bucketMap = {
    "contracheque": "contracheques",
    "folha-ponto": "folhas-ponto",
    "comprovante": "comprovantes"
};

const bucketDestino = bucketMap[resultado.tipo];

if (bucketDestino) {

    const nomeArquivo =
        `${Date.now()}_${caminho}`;

    const { error } =
        await supabaseAdmin.storage
            .from(bucketDestino)
            .upload(
                nomeArquivo,
                fileBuffer,
                {
                    contentType: mediaType,
                    upsert: true
                }
            );

    if (error) {
        throw new Error(
            `Erro ao salvar arquivo: ${error.message}`
        );
    }

    resultado.bucket = bucketDestino;
    resultado.caminho = nomeArquivo;
}

    if (resultado.confianca.requer_revisao) {

        await adicionarNaFila(
            supabaseAdmin,
            {
                tipo: resultado.tipo,
                extracao: resultado.dados,
                confianca: resultado.confianca,
                caminho,
                bucket
            }
        );
    }

    return resultado;
}

module.exports = {
    processarDocumento,
    processarESalvarNaFila
};