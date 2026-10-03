import { createSignupHandler } from './handler.mjs';
// Endpoint antigo desativado: não cria contas ou senhas.
Deno.serve(createSignupHandler());
