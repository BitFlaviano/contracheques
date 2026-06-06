async function adicionarNaFila(supabaseAdmin, { tipo, extracao, confianca, caminho, bucket }) {
    const { error } = await supabaseAdmin
        .from('fila_revisao')
        .insert({
            tipo_documento: tipo,
            dados_extraidos: extracao,
            confianca: confianca,
            arquivo_caminho: caminho,
            bucket: bucket,
            status: 'pendente'
        });

    if (error) console.error('Erro ao adicionar na fila de revisão:', error.message);
}

async function listarFila(supabaseAdmin, status = 'pendente') {
    const { data, error } = await supabaseAdmin
        .from('fila_revisao')
        .select('*')
        .eq('status', status)
        .order('created_at', { ascending: false });

    if (error) throw error;
    return data || [];
}

async function resolverItem(supabaseAdmin, id, dadosCorrigidos) {
    const { error } = await supabaseAdmin
        .from('fila_revisao')
        .update({
            status: 'revisado',
            dados_corrigidos: dadosCorrigidos,
            revisado_em: new Date().toISOString()
        })
        .eq('id', id);

    if (error) throw error;
}

module.exports = { adicionarNaFila, listarFila, resolverItem };