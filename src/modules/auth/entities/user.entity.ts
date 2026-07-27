import { Column, Entity } from 'typeorm';
import { Exclude } from 'class-transformer';
import { BaseEntity } from '../../../common/database/base.entity.js';

@Entity('users')
export class UserEntity extends BaseEntity {
  @Column({ length: 200 })
  name: string;

  @Column({ unique: true })
  email: string;

  @Exclude()
  @Column({ name: 'password_hash' })
  passwordHash: string;

  @Column({ default: true })
  isActive: boolean;
}
