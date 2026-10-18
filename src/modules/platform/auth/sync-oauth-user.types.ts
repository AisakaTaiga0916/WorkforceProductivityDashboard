export type OAuthProfileInput = {
  email: string;
  name?: string | null;
  image?: string | null;
  provider: string;
  providerAccountId: string;
  roleHint?: string | null;
};
