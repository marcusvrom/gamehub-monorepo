// Função auxiliar para centralizar o tratamento de erros
const handleRequest = async (res, callback) => {
  try {
    await callback();
  } catch (err) {
    console.error('ERRO NA ROTA:', err.stack);
    if (!res.headersSent) {
      if (err.code === '23505') { 
        return res.status(409).json({ message: 'Erro: Dados duplicados. A informação já pode estar cadastrada.', code: err.code });
      }
      res.status(500).json({ message: 'Erro interno do servidor.', error: err.message });
    }
  }
};