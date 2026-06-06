const CAMPOS_OBRIGATORIOS = {
    contracheque:  ['nome_funcionario', 'salario_liquido'],
    'folha-ponto': ['funcionario', 'periodo'],
    comprovante:   ['nome', 'valor']
};

const CAMPOS_NUMERICOS = {
    contracheque:  ['salario_bruto', 'salario_liquido', 'descontos', 'beneficios', 'horas_extras'],
    'folha-ponto': [],
    comprovante:   ['valor']
};

function validar(dados, tipo) {
    const erros = [];
    const obrigatorios = CAMPOS_OBRIGATORIOS[tipo] || [];
    const numericos = CAMPOS_NUMERICOS[tipo] || [];

    for (const campo of obrigatorios) {
        const val = dados[campo];
        const ausente = val === null || val === undefined || val === '' ||
            (typeof val === 'number' && isNaN(val));
        if (ausente) {
            erros.push(`Campo obrigatório ausente ou vazio: ${campo}`);
        }
    }

    for (const campo of numericos) {
        const val = dados[campo];
        if (val !== null && val !== undefined && typeof val !== 'number') {
            erros.push(`Campo ${campo} deve ser numérico`);
        }
    }

    return { valido: erros.length === 0, erros };
}

module.exports = { validar };