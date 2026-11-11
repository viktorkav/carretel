# Carretel

Aplicação web gratuita para acompanhar impressões 3D. Cadastre impressoras e rolos, registre impressões e veja quanto cada peça custou em material, energia, depreciação e manutenção. O estoque usa as suas pesagens e sinaliza rolos com pouco material ou risco de umidade.

## Como rodar

Com Git e Node.js 22 instalados, execute no terminal:

```sh
git clone https://github.com/viktorkav/carretel.git
cd carretel
npm ci
npm run db:migrate
npm run dev -- --host 127.0.0.1
```

Abra [localhost:5173](http://localhost:5173). Cadastre uma impressora e um rolo para registrar a primeira impressão. O cadastro manual funciona sem conta Bambu, impressora conectada ou catálogo externo.

O Carretel foi feito para uso local e guarda os dados em `dev.sqlite` e as imagens em `uploads/`. Faça backup desses dados antes de atualizar uma instalação que já está em uso.

## Build e testes

```sh
npm run check
npm test
npm run build
HOST=127.0.0.1 PORT=5173 node build
```

Rode `npm run db:migrate` ao atualizar para uma versão com novas migrações. `DATABASE_PATH` e `UPLOADS_PATH` permitem escolher outros caminhos para o banco e os arquivos enviados.

## Catálogo de filamentos

O catálogo é opcional. Para baixar a base pela primeira vez, use `npm run catalogo` ou abra **Configuração → Catálogo de filamentos** no Carretel. Os dados gerados ficam na instalação. A base vem dos [perfis de filamento do Bambu Studio](https://github.com/bambulab/BambuStudio/tree/a803118282d8208361b4584b720af175dd1a9b4e/resources/profiles/BBL/filament), sob AGPL-3.0.

As fontes Manrope e Unbounded têm seus avisos SIL OFL em [`static/fontes`](static/fontes/). As ilustrações de rolos e impressora desta versão foram geradas com a Higgsfield.
