# RP IPTV — página de pareamento

Página para enviar uma lista M3U do celular para a TV LG.

## Publicar no GitHub Pages
1. Crie um repositório público no GitHub (ex.: `rp-iptv-pareamento`).
2. Envie os arquivos desta pasta (`index.html`, `config.js`) para a raiz do repositório.
3. Em **Settings › Pages**, em *Build and deployment*, escolha **Deploy from a branch**, branch `main`, pasta `/ (root)`.
4. Em alguns minutos o site fica em `https://SEU_USUARIO.github.io/rp-iptv-pareamento/`.

Esse endereço precisa ser o mesmo que o app da TV usa para gerar o QR code.

## Segurança
- A tabela do banco fica bloqueada para leitura pública. A página só chama a função `enviar_url`.
- A URL enviada é apagada da tabela quando a TV a retira, e expira em 10 minutos.
