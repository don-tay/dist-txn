import { Injectable, Inject, OnModuleInit, Logger } from '@nestjs/common';
import { ClientKafka } from '@nestjs/microservices';
import { KAFKA_CLIENT } from './kafka.constants';

/**
 * Kafka producer service for publishing events.
 *
 * This service provides a single generic publish method used by the
 * OutboxPublisherService. All event publishing goes through the outbox
 * pattern for reliable delivery.
 */
@Injectable()
export class KafkaProducerService implements OnModuleInit {
  private readonly logger = new Logger(KafkaProducerService.name);

  constructor(
    @Inject(KAFKA_CLIENT) private readonly kafkaClient: ClientKafka,
  ) {}

  async onModuleInit(): Promise<void> {
    await this.kafkaClient.connect();
    this.logger.debug('Kafka producer connected');
  }

  /**
   * Publish an event to a Kafka topic.
   *
   * @param topic - Kafka topic name
   * @param key - Message key for partitioning (ensures ordering per key)
   * @param payload - Event payload
   */
  publish(topic: string, key: string, payload: Record<string, unknown>): void {
    this.kafkaClient.emit(topic, { key, value: payload });
    this.logger.debug(`Published to ${topic}: ${key}`);
  }
}
