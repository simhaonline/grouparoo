import {
  Column,
  Model,
  CreatedAt,
  UpdatedAt,
  BeforeCreate,
  AfterCreate,
  AfterUpdate,
  AfterDestroy,
  AfterBulkCreate,
} from "sequelize-typescript";
import * as uuid from "uuid";
import { Log } from "../models/Log";
import { config } from "actionhero";

function modelName(instance): string {
  let name = instance.constructor.name;
  name = name[0].toLowerCase() + name.substr(1);
  return name;
}

export abstract class LoggedModel<T> extends Model<T> {
  /**
   * return the prefix for this type of class' guid
   */
  abstract guidPrefix(): string;

  @Column({ primaryKey: true })
  guid: string;

  @BeforeCreate
  static generateGuid(instance) {
    if (!instance.guid) {
      instance.guid = `${instance.guidPrefix()}_${uuid.v4()}`;
    }
  }

  @CreatedAt
  createdAt: Date;

  @UpdatedAt
  updatedAt: Date;

  @AfterCreate
  static async logCreate(instance) {
    await Log.create({
      topic: modelName(instance),
      verb: "create",
      data: await instance.filteredDataForLogging(),
      message: await instance.logMessage("create"),
    });
  }

  @AfterBulkCreate
  static async logBulkCreate(instances) {
    for (const i in instances) {
      const instance = instances[i];
      await Log.create({
        topic: modelName(instance),
        verb: "create",
        data: await instance.filteredDataForLogging(),
        message: await instance.logMessage("create"),
      });
    }
  }

  @AfterUpdate
  static async logUpdate(instance) {
    await Log.create({
      topic: modelName(instance),
      verb: "update",
      data: await instance.filteredDataForLogging(),
      message: await instance.logMessage("update"),
    });
  }

  @AfterDestroy
  static async logDestroy(instance) {
    await Log.create({
      topic: modelName(instance),
      verb: "destroy",
      data: await instance.filteredDataForLogging(),
      message: await instance.logMessage("destroy"),
    });
  }

  async filteredDataForLogging() {
    const apiData = await this.apiData();

    config.general.filteredParams.forEach((p) => {
      if (apiData[p]) {
        apiData[p] = "** filtered **";
      }
    });

    if (apiData.options) {
      apiData.options = "** filtered **";
    }

    return apiData;
  }

  async logMessage(verb: "create" | "update" | "destroy") {
    let message = "";
    let primaryName = this.guid;
    const possibleNames = ["name", "key", "email", "path"];
    for (let i in possibleNames) {
      if (this[possibleNames[i]]) {
        primaryName = this[possibleNames[i]];
        break;
      }
    }

    switch (verb) {
      case "create":
        message = `${modelName(this)} "${primaryName}" created`;
        break;
      case "update":
        const changedValueStrings = [];
        const changedKeys = this.changed() as Array<string>;
        if (changedKeys) {
          changedKeys.forEach((k) => {
            let value = this[k];
            if (config.general.filteredParams.includes(k)) {
              value = "** filtered **";
            }

            changedValueStrings.push(`${k} -> ${value}`);
          });
        }

        message = `${modelName(
          this
        )} "${primaryName}" updated: ${changedValueStrings.join(", ")}`;
        break;
      case "destroy":
        message = `${modelName(this)} "${primaryName}" destroyed`;
        break;
    }

    return message;
  }

  abstract apiData(): Promise<{ [key: string]: any }>;
}
