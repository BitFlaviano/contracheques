const CAMPOS_POR_TIPO = {
    contracheque:  ['nome_funcionario', 'cpf', 'empresa', 'competencia', 'salario_bruto', 'salario_liquido', 'descontos', 'beneficios', 'horas_extras', 'cargo'],
    'folha-ponto': ['funcionario', 'periodo', 'entradas', 'saidas', 'horas_trabalhadas', 'banco_horas', 'ausencias'],
    comprovante:   ['nome', 'cpf', 'data', 'valor', 'instituicao_emissora', 'tipo_comprovante']
};

function calcularConfianca(dados, tipo) {
    const campos = CAMPOS_POR_TIPO[tipo] || Object.keys(dados);
    const detalhe = {};
    let camposPreenchidos = 0;

    for (const campo of campos) {
        const val = dados[campo];
        const preenchido =
            val !== null &&
            val !== undefined &&
            val !== '' &&
            !(typeof val === 'number' && (isNaN(val) || val === 0)) &&
            !(Array.isArray(val) && val.length === 0);

        detalhe[campo] = preenchido ? 'alto' : 'baixo';
        if (preenchido) camposPreenchidos++;
    }

    const confiancaGeral = Math.round((camposPreenchidos / campos.length) * 100);

    return {
        confianca_geral: confiancaGeral,
        nivel: confiancaGeral >= 80 ? 'alto' : confiancaGeral >= 50 ? 'medio' : 'baixo',
        requer_revisao: confiancaGeral < 70,
        campos_preenchidos: camposPreenchidos,
        total_campos: campos.length,
        detalhe
    };
}

module.exports = { calcularConfianca };