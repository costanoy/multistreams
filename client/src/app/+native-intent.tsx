import type { NativeIntent } from 'expo-router';

/** Volta do login: o token (ou o erro) vem na query ou no fragmento do link. */
const LOGIN_BACK = /[?#&](access_token|error|error_code)=/;

/**
 * Links que chegam ao app (só no Android e no iOS). No Android, a volta do login é um link
 * (multistreams://import?from=onboarding#access_token=…) que o expo-web-browser já espera: com o app aberto,
 * o expo-router não navega por ele, senão a tela de volta ficaria empilhada sobre a boas-vindas.
 * Quem pediu o login escolhe para onde ir.
 */
export const redirectSystemPath: NonNullable<NativeIntent['redirectSystemPath']> = ({ path, initial }) =>
  !initial && LOGIN_BACK.test(path) ? null : path;
