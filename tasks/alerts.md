Precisamos criar uma nova funcionalidade. 

Precisamos criar uma tarefa cronológica que irá percorrer todos os nossos clientes buscar
alguns dados dos anúncios na API do meta e disparar uma mensagem no grupo de managers do whatsapp toda manhã com essas informações.

- Retornar ROAS de cada cliente a nivel de conjunto de anúncio
- Retornar última data de edição de cada conjunto de anúncio

Pontos importantes: 
- Para evitar que a meta bloqueie a nossa aplicação é ideal que o cron rode entre 07:30 e 8:00 da manhã mas a cada dia em um minuto aleatório. 

- Devemos buscar os dados por meio de nossa integração com a a API do Meta (algo como o endpoint /insights).
- Vamos criar uma tabela no banco de dados para armazenar os dados que serão enviados para o grupo de managers
- Vamos criar uma tabela para salvar jobs para podermos ativar/desativar via endpoint. O job deve ter id, tipo (alarme de conjunto de anúncios), status (ativo/inativo), campos a serem retornardos. 
- Devemos criar um endpoint para listar os jobs e ativar/desativar.
- Iremos criar uma tela no painel administrativo (trafegoflow-dashboard) para visualizar os jobs e ativar/desativar.

O layout da mensagem deve ser:

**Nome do cliente**: {nome do cliente}

**Conjunto de anúncios**: {nome do conjunto de anúncios} | **ROAS**: {roas} | **Última atualização**: {ultima atualização}

**Conjunto de anúncios**: {nome do conjunto de anúncios} | **ROAS**: {roas} | **Última atualização**: {ultima atualização}

**Nome do cliente**: {nome do cliente} 

**Conjunto de anúncios**: {nome do conjunto de anúncios} | **ROAS**: {roas} | **Última atualização**: {ultima atualização}

**Conjunto de anúncios**: {nome do conjunto de anúncios} | **ROAS**: {roas} | **Última atualização**: {ultima atualização}

...
