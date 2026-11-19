// RF-001.5 a RF-001.12 (requisitos v1.16, UX 0.12): o app abre com o desbloqueio do aparelho — biometria ou o PIN,
// o padrão ou a senha do aparelho, num pedido só do sistema (V-F). Sem login e sem conta.
import * as LocalAuthentication from 'expo-local-authentication';

/** O aparelho tem bloqueio de tela (biometria, PIN, padrão ou senha)? Sem bloqueio, o app abre direto (RF-001.8). */
export async function deviceHasScreenLock(): Promise<boolean> {
  try {
    return (await LocalAuthentication.getEnrolledLevelAsync()) !== LocalAuthentication.SecurityLevel.NONE;
  } catch {
    return false;
  }
}

export type UnlockResult = { ok: true } | { ok: false; reason: 'cancel' | 'lockout' | 'unavailable' | 'nolock' };

/**
 * Pede o desbloqueio do aparelho. `disableDeviceFallback: false` → BiometricPrompt com BIOMETRIC_WEAK |
 * DEVICE_CREDENTIAL (Android 11+); abaixo do Android 11, o PIN/padrão/senha vem da tela do sistema
 * (KeyguardManager). O app não conta tentativas: "lockout" é o que o sistema informa (RF-001.7, V-G).
 */
export async function unlockDevice(promptMessage: string): Promise<UnlockResult> {
  try {
    const r = await LocalAuthentication.authenticateAsync({ promptMessage, disableDeviceFallback: false, requireConfirmation: false });
    if (r.success) return { ok: true };
    if (r.error === 'lockout') return { ok: false, reason: 'lockout' };
    if (r.error === 'not_enrolled' || r.error === 'passcode_not_set') return { ok: false, reason: 'nolock' };
    if (r.error === 'not_available' || r.error === 'unable_to_process' || r.error === 'invalid_context' || r.error === 'unknown') return { ok: false, reason: 'unavailable' };
    return { ok: false, reason: 'cancel' };
  } catch {
    return { ok: false, reason: 'unavailable' };
  }
}

/** Volta de segundo plano depois de mais de 60 s pede o desbloqueio de novo (RF-001.6). */
export const LOCK_AFTER_BACKGROUND_MS = 60 * 1000;
