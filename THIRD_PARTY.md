# Componentes de terceiros

## AI Memory

- Projeto: https://github.com/akitaonrails/ai-memory
- Autor: akitaonrails e contribuidores.
- Versão integrada: 3.1.0.
- Licença: MIT, disponível em https://github.com/akitaonrails/ai-memory/blob/v3.1.0/LICENSE.
- Distribuição: o instalador obtém o binário da release oficial e valida o checksum SHA-256 publicado. Binário, banco, wiki e registros não são versionados neste repositório.

O Orquestra inicia o servidor original por MCP stdio e oferece uma interface limitada ao projeto para notas, busca, contexto e handoffs. Não redistribui uma cópia modificada do código do AI Memory.

As demais dependências e respectivas versões estão em `package.json` e `package-lock.json`; suas licenças acompanham os pacotes instalados pelo npm.

## Distribuição desktop

- Electron e Chromium: distribuídos pelo electron-builder com seus arquivos de licença.
- Node.js: o pacote inclui o `node.exe` usado na preparação e `backend/NODE-LICENSE.txt`, obtido da tag oficial correspondente em https://github.com/nodejs/node.
- Dependências do backend, incluindo node-pty: distribuídas em `backend/node_modules`, com seus avisos de licença originais.
- AI Memory: quando instalado localmente antes da preparação, seu executável original e licença MIT são incluídos em `backend/runtime/ai-memory`. Dados e configurações pessoais não são distribuídos.
