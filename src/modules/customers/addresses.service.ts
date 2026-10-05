import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, EntityManager, Repository } from 'typeorm';
import { AuthContext } from '../auth/interfaces/auth-context.interface';
import { CreateAddressDto, UpdateAddressDto } from './dto/customer-me.dto';
import { CustomerAddress } from './entities/customer-address.entity';
import { MeService, toIndiaE164 } from './me.service';

@Injectable()
export class AddressesService {
  constructor(
    @InjectRepository(CustomerAddress)
    private readonly addressRepository: Repository<CustomerAddress>,
    private readonly meService: MeService,
    private readonly dataSource: DataSource,
  ) {}

  async list(auth: AuthContext): Promise<CustomerAddress[]> {
    const profile = await this.meService.ensureProfile(auth);
    return this.addressRepository.find({
      where: { customerProfileId: profile.id },
      order: { isDefault: 'DESC', createdAt: 'ASC' },
    });
  }

  async create(
    auth: AuthContext,
    dto: CreateAddressDto,
  ): Promise<CustomerAddress> {
    const profile = await this.meService.ensureProfile(auth);
    return this.dataSource.transaction(async (manager) => {
      const repo = manager.getRepository(CustomerAddress);
      const count = await repo.count({
        where: { customerProfileId: profile.id },
      });
      const makeDefault = count === 0 || dto.isDefault === true;
      if (makeDefault) {
        await this.clearDefault(manager, profile.id);
      }
      const address = repo.create({
        customerProfileId: profile.id,
        label: dto.label.trim(),
        line1: dto.line1.trim(),
        line2: dto.line2?.trim() || null,
        landmark: dto.landmark?.trim() || null,
        city: dto.city.trim(),
        state: dto.state?.trim() || null,
        postalCode: dto.postalCode,
        contactPhone: dto.contactPhone ? toIndiaE164(dto.contactPhone) : null,
        latitude: dto.latitude ?? null,
        longitude: dto.longitude ?? null,
        isDefault: makeDefault,
      });
      return repo.save(address);
    });
  }

  async update(
    auth: AuthContext,
    id: string,
    dto: UpdateAddressDto,
  ): Promise<CustomerAddress> {
    const address = await this.getOwned(auth, id);
    return this.dataSource.transaction(async (manager) => {
      const repo = manager.getRepository(CustomerAddress);
      if (dto.isDefault === true && !address.isDefault) {
        await this.clearDefault(manager, address.customerProfileId);
        address.isDefault = true;
      }
      if (dto.label !== undefined) address.label = dto.label.trim();
      if (dto.line1 !== undefined) address.line1 = dto.line1.trim();
      if (dto.line2 !== undefined) address.line2 = dto.line2.trim() || null;
      if (dto.landmark !== undefined) {
        address.landmark = dto.landmark.trim() || null;
      }
      if (dto.city !== undefined) address.city = dto.city.trim();
      if (dto.state !== undefined) address.state = dto.state.trim() || null;
      if (dto.postalCode !== undefined) address.postalCode = dto.postalCode;
      if (dto.contactPhone !== undefined) {
        address.contactPhone = toIndiaE164(dto.contactPhone);
      }
      if (dto.latitude !== undefined) address.latitude = dto.latitude;
      if (dto.longitude !== undefined) address.longitude = dto.longitude;
      return repo.save(address);
    });
  }

  async remove(auth: AuthContext, id: string): Promise<void> {
    const address = await this.getOwned(auth, id);
    await this.dataSource.transaction(async (manager) => {
      const repo = manager.getRepository(CustomerAddress);
      const wasDefault = address.isDefault;
      address.isDefault = false;
      await repo.save(address);
      await repo.softRemove(address);
      if (wasDefault) {
        const next = await repo.findOne({
          where: { customerProfileId: address.customerProfileId },
          order: { createdAt: 'DESC' },
        });
        if (next) {
          next.isDefault = true;
          await repo.save(next);
        }
      }
    });
  }

  async getOwned(auth: AuthContext, id: string): Promise<CustomerAddress> {
    const profile = await this.meService.ensureProfile(auth);
    const address = await this.addressRepository.findOne({
      where: { id, customerProfileId: profile.id },
    });
    if (!address) {
      throw new NotFoundException();
    }
    return address;
  }

  private async clearDefault(
    manager: EntityManager,
    customerProfileId: string,
  ): Promise<void> {
    await manager
      .getRepository(CustomerAddress)
      .update({ customerProfileId, isDefault: true }, { isDefault: false });
  }
}
