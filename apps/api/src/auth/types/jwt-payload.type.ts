// Access ve refresh JWT'lerinin payload'ı — ikisi de aynı şekli kullanıyor,
// hangi secret ile imzalandığı/doğrulandığı stratejiler tarafında ayrılıyor.
export interface JwtPayload {
  sub: string; // user id
  email: string;
}

export interface AuthTokens {
  accessToken: string;
  refreshToken: string;
}
