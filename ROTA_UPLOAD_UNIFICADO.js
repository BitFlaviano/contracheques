// =============================
// FUNÇÃO: UPLOAD UNIFICADO COM CLAUDE
// COLE ISTO NO server.js APÓS A LINHA 1260 (após app.post('/upload-ponto'))
// =============================
app.post('/upload-unificado', upload.array('pdfs'), async (req, res) => {
    try {
        const admin = await validarAdmin(req, res);
        if (!admin) return;

        if (!req.files || req.files.length === 0) {
            return res.status(400).json({ erro: "Nenhum arquivo enviado" });
        }

        const pastaUpload = gerarTimestamp();
        const documentos = [];

        // Processar cada PDF
        for (const file of req.files) {
            try {
                const pdfBuffer = file.buffer;
                const dadosPdf = await pdfParse(pdfBuffer);
                const textoPdf = dadosPdf.text;

                // Analisar com Claude
                const analise = await analisarDocumento(textoPdf);

                // Mapear tipo para bucket correto
                const tiposMap = {
                    'contracheque': 'contracheques',
                    'comprovante': 'comprovantes',
                    'folha-ponto': 'folhas-ponto'
                };

                const bucket = tiposMap[analise.tipo] || 'contracheques';
                const nomeArquivo = `${analise.nome} ${analise.periodo}.pdf`;
                const caminho = `${pastaUpload}/${nomeArquivo}`;

                // Salvar no Supabase
                const { error } = await supabaseAdmin.storage
                    .from(bucket)
                    .upload(caminho, pdfBuffer, {
                        contentType: 'application/pdf',
                        upsert: true
                    });

                if (error) throw error;

                // Adicionar aos resultados
                documentos.push({
                    tipo: analise.tipo,
                    nome: analise.nome,
                    periodo: analise.periodo,
                    confianca: analise.confianca,
                    observacoes: analise.observacoes,
                    nomeArquivo: nomeArquivo,
                    bucket: bucket
                });

                console.log(`✓ PDF PROCESSADO: ${bucket}/${caminho}`);

            } catch (err) {
                console.error('Erro ao processar PDF:', err);
                documentos.push({
                    tipo: 'erro',
                    nome: 'N/A',
                    periodo: 'N/A',
                    confianca: 0,
                    observacoes: err.message,
                    nomeArquivo: file.originalname,
                    erro: true
                });
            }
        }

        // Enviar email se configurado
        if (smtpConfigurado()) {
            try {
                const sucessos = documentos.filter(d => !d.erro).length;
                
                await enviarEmail({
                    from: 'Portal Kidverte <nao-responda@kidverte.com.br>',
                    to: process.env.EMAIL_DESTINO_CONTRACHEQUES || 'financeiro@kidverte.com.br',
                    subject: `[Kidverte] ${sucessos} documento(s) processado(s) com Claude`,
                    html: `
                        <h3>Documentos Processados com Claude AI</h3>
                        <p><strong>Total de arquivos:</strong> ${documentos.length}</p>
                        <p><strong>Processados com sucesso:</strong> ${sucessos}</p>
                        
                        <h4>Detalhes:</h4>
                        <ul>
                            ${documentos.map(d => {
                                if (d.erro) {
                                    return `<li style="color: red;">❌ ${d.nomeArquivo}: ${d.observacoes}</li>`;
                                }
                                return `<li>✓ ${d.tipo}: ${d.nome} (${d.periodo}) - Confiança: ${(d.confianca * 100).toFixed(0)}%</li>`;
                            }).join('')}
                        </ul>
                        
                        <p style="color:#888;font-size:12px">Enviado automaticamente pelo Portal Kidverte com Claude AI</p>
                    `
                });

                console.log(`✓ EMAIL ENVIADO: ${sucessos} documento(s) processado(s)`);

            } catch (emailErr) {
                console.error('Erro ao enviar email:', emailErr);
            }
        }

        res.json({ sucesso: true, documentos });

    } catch (err) {
        console.error('ERRO NO UPLOAD UNIFICADO:', err);
        res.status(500).json({ erro: err.message });
    }
});
