// Testes de tela (jest-expo + Testing Library): estados de T-03 (desbloqueio, UX 0.12) e T-06.
import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import { PaperProvider } from 'react-native-paper';
import { PluggyError } from '../../pluggy/client';

const mockUnlock = jest.fn();
const mockTestCredentials = jest.fn();
const mockSaveCredentials = jest.fn();

jest.mock('../../services/secure', () => ({
  secure: { saveCredentials: (...a: unknown[]) => mockSaveCredentials(...a) },
}));
jest.mock('../../state/AppContext', () => ({
  useApp: () => ({
    unlock: (...a: unknown[]) => mockUnlock(...a),
    client: { testCredentials: mockTestCredentials, clearCache: jest.fn() },
    reloadCredStatus: jest.fn(),
    repo: { setState: jest.fn() },
  }),
}));
jest.mock('expo-router', () => ({
  router: { back: jest.fn(), push: jest.fn(), dismissTo: jest.fn() },
  useLocalSearchParams: () => ({}),
}));
jest.mock('expo-clipboard', () => ({ getStringAsync: jest.fn(async () => '') }));
// eslint-disable-next-line @typescript-eslint/no-require-imports
jest.mock('react-native-safe-area-context', () => require('react-native-safe-area-context/jest/mock').default);

// eslint-disable-next-line @typescript-eslint/no-require-imports
const { UnlockScreen } = require('../../ui/UnlockScreen');
// eslint-disable-next-line @typescript-eslint/no-require-imports
const Informar = require('../credenciais/informar').default;

const wrap = async (ui: React.ReactElement) => render(<PaperProvider>{ui}</PaperProvider>);

beforeEach(() => jest.clearAllMocks());

describe('T-03 Desbloqueio (RF-001.5 a RF-001.9, UX-079, UX-004)', () => {
  test('abre o pedido do sistema sozinho; só nome, frase e "Desbloquear", sem dados', async () => {
    mockUnlock.mockResolvedValue({ ok: true });
    await wrap(<UnlockScreen />);
    await waitFor(() => expect(mockUnlock).toHaveBeenCalledTimes(1));
    expect(screen.getByText('Desbloqueie para ver suas finanças.')).toBeTruthy();
    expect(screen.getByText('Desbloquear')).toBeTruthy();
    expect(screen.queryByText(/Entrar de novo/)).toBeNull();
    expect(screen.queryByText(/R\$/)).toBeNull();
  });
  test('cancelado ou não reconhecido: continua em T-03 com a mensagem definida', async () => {
    mockUnlock.mockResolvedValue({ ok: false, reason: 'cancel' });
    await wrap(<UnlockScreen />);
    expect(await screen.findByText('O desbloqueio não foi concluído. Toque em Desbloquear para tentar de novo.')).toBeTruthy();
  });
  test('muitas tentativas: o que o sistema informa, sem o app contar; "Desbloquear" continua', async () => {
    mockUnlock.mockResolvedValue({ ok: false, reason: 'lockout' });
    await wrap(<UnlockScreen />);
    expect(await screen.findByText('Muitas tentativas. Tente de novo mais tarde ou use o PIN, o padrão ou a senha do aparelho.')).toBeTruthy();
    mockUnlock.mockResolvedValue({ ok: true });
    await fireEvent.press(screen.getByText('Desbloquear'));
    await waitFor(() => expect(mockUnlock).toHaveBeenCalledTimes(2));
  });
  test('pedido que não abriu', async () => {
    mockUnlock.mockResolvedValue({ ok: false, reason: 'unavailable' });
    await wrap(<UnlockScreen />);
    expect(await screen.findByText('Não foi possível abrir o desbloqueio do aparelho. Tente de novo.')).toBeTruthy();
  });
});

describe('T-06 Informar credenciais (RF-000.2, RF-000.3, UX-008, UX-009)', () => {
  const fill = async (id: string, secret: string) => {
    await fireEvent.changeText(screen.getByLabelText('Client ID'), id);
    await fireEvent.changeText(screen.getByLabelText('Client Secret'), secret);
    await fireEvent.press(screen.getByText('Testar e salvar'));
  };

  test('campos vazios: erro em cada campo', async () => {
    await wrap(<Informar />);
    await fireEvent.press(screen.getByText('Testar e salvar'));
    expect(await screen.findByText('Informe o Client ID.')).toBeTruthy();
    expect(mockTestCredentials).not.toHaveBeenCalled();
  });
  test('inválidas: mensagem definida, valores ficam, nada é salvo', async () => {
    mockTestCredentials.mockRejectedValue(new PluggyError('invalid_credentials', 401, 'CLIENT_KEYS_UNAUTHORIZED'));
    await wrap(<Informar />);
    await fill('3fa85f64-5717-4562-b3fc-2c963f66afa6', 'pluggy_sk_errado');
    expect(await screen.findByText('O Pluggy não reconheceu esses códigos. Confira se copiou os dois da mesma aplicação e tente de novo.')).toBeTruthy();
    expect(mockSaveCredentials).not.toHaveBeenCalled();
    expect(screen.getByLabelText('Client ID').props.value).toBe('3fa85f64-5717-4562-b3fc-2c963f66afa6');
    // RF-000.3: o segredo não aparece em nenhum texto da tela
    expect(screen.queryByText(/pluggy_sk_errado/)).toBeNull();
  });
  test('sem rede: mensagem diferente, sem dizer que são inválidas', async () => {
    mockTestCredentials.mockRejectedValue(new PluggyError('network', null, null));
    await wrap(<Informar />);
    await fill('3fa85f64-5717-4562-b3fc-2c963f66afa6', 'pluggy_sk_x');
    expect(await screen.findByText('Não foi possível falar com o Pluggy agora. Seus códigos não foram salvos. Tente de novo.')).toBeTruthy();
    expect(screen.queryByText(/não reconheceu/)).toBeNull();
    expect(mockSaveCredentials).not.toHaveBeenCalled();
  });
  test('espaços e quebras nas pontas são removidos antes de testar (UX-008)', async () => {
    mockTestCredentials.mockResolvedValue(undefined);
    await wrap(<Informar />);
    await fill('  3fa85f64-5717-4562-b3fc-2c963f66afa6\n', '\n pluggy_sk_ok \t');
    await waitFor(() => expect(mockTestCredentials).toHaveBeenCalledWith({ clientId: '3fa85f64-5717-4562-b3fc-2c963f66afa6', clientSecret: 'pluggy_sk_ok' }));
    await waitFor(() => expect(mockSaveCredentials).toHaveBeenCalled());
  });
  test('dica de formato quando o Secret é colado no campo do Client ID', async () => {
    await wrap(<Informar />);
    await fireEvent.changeText(screen.getByLabelText('Client ID'), 'pluggy_sk_abc');
    expect(screen.getByText('Este parece ser o Client Secret. Cole no campo de baixo.')).toBeTruthy();
  });
});
