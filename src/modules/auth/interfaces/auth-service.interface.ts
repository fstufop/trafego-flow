import { UserEntity } from '../entities/user.entity.js';
import { LoginDto } from '../dto/login.dto.js';
import { CreateUserDto } from '../dto/create-user.dto.js';

export interface JwtPayload {
  sub: string;
  email: string;
  name: string;
}

export interface LoginResult {
  accessToken: string;
  tokenType: 'Bearer';
  expiresIn: string;
  user: UserEntity;
}

export interface IAuthService {
  login(dto: LoginDto): Promise<LoginResult>;
  createUser(dto: CreateUserDto): Promise<UserEntity>;
  findById(id: string): Promise<UserEntity>;
}
