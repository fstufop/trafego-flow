import { UserEntity } from '../entities/user.entity.js';
import { LoginDto } from '../dto/login.dto.js';
import { CreateUserDto } from '../dto/create-user.dto.js';

export interface JwtPayload {
  sub: string;
  email: string;
  name: string;
  // Present only on narrowly-scoped, short-lived tokens (e.g. direct-upload
  // tokens) — absent on normal session tokens. Guards that protect general
  // endpoints must reject any token carrying a scope they don't expect.
  scope?: string;
}

export interface LoginResult {
  accessToken: string;
  tokenType: 'Bearer';
  expiresIn: string;
  user: UserEntity;
}

export interface UploadTokenResult {
  accessToken: string;
  tokenType: 'Bearer';
  expiresIn: string;
}

export interface IAuthService {
  login(dto: LoginDto): Promise<LoginResult>;
  createUser(dto: CreateUserDto): Promise<UserEntity>;
  findById(id: string): Promise<UserEntity>;
  issueUploadToken(currentUser: JwtPayload): Promise<UploadTokenResult>;
}
