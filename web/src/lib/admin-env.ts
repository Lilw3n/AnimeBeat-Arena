/** Email listé dans ADMIN_EMAIL (.env) = compte admin (à l’inscription ou à la prochaine connexion). */
export function isConfiguredAdminEmail(email: string): boolean {
  const admin = process.env.ADMIN_EMAIL?.trim().toLowerCase();
  return Boolean(admin && email.toLowerCase() === admin);
}
