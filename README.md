# financas-app

App Android de controle de finanças pessoais (pt-BR, BRL). Mostra saldos, extrato, categorias e a validade das autorizações das suas contas, num só lugar, com os dados guardados só no aparelho.

## Como funciona

- Os dados dos bancos vêm pelo Open Finance, através do [Meu Pluggy](https://meu.pluggy.ai) (conector "MeuPluggy" do [Pluggy](https://pluggy.ai)).
- Cada pessoa usa as **próprias** credenciais do Pluggy (Client ID e Client Secret de uma aplicação criada no [painel do Pluggy](https://dashboard.pluggy.ai)). O app não tem servidor: as credenciais e os dados ficam só no aparelho, em armazenamento protegido e SQLite local.
- O app abre com o desbloqueio do próprio aparelho (biometria, PIN, padrão ou senha). Não há login nem conta.

**Só para uso pessoal.** O plano gratuito do Pluggy com o Meu Pluggy serve para ler as suas próprias contas. Este projeto não é um produto, não tem relação com o Pluggy e não deve ser usado para dados de terceiros.

## Como rodar

Requisitos: Node 20+, Android SDK (emulador ou celular com depuração USB) e JDK 17.

```bash
npm install
npx expo run:android   # gera a pasta android/ e instala o build de desenvolvimento
npm test               # testes (Jest)
npm run typecheck      # TypeScript
```

Na primeira abertura, o app mostra um guia para criar a conta no Meu Pluggy, a aplicação no painel do Pluggy e colar os dois códigos.

## Stack

Expo SDK 58 / React Native, Expo Router, React Native Paper (Material 3), expo-sqlite, expo-secure-store, expo-local-authentication, react-native-pluggy-connect.

## Licença

[MIT](LICENSE)
