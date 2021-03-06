import faker from "faker";
import { Destination } from "./../../src/models/Destination";
import AppFactory from "./app";

const data = async (props = {}) => {
  const defaultProps = {
    name: `destination ${faker.company.companyName()}-${Math.random()}`,
    type: "test-plugin-export",
    options: {},
    mapping: {},

    createdAt: new Date(),
    updatedAt: new Date(),
  };

  return Object.assign({}, defaultProps, props);
};

export default async (app?, props: { [key: string]: any } = {}) => {
  if (!app) {
    // the postgres app has imports and exports
    app = await AppFactory({ type: "test-plugin-app", options: {} });
    await app.setOptions({
      fileGuid: "abc123",
    });
  }

  props.appGuid = app.guid;
  const mergedProps = await data(props);
  const instance = new Destination(mergedProps);
  await instance.save();

  if (Object.keys(mergedProps.options).length > 0) {
    await instance.setOptions(mergedProps.options);
  }

  if (Object.keys(mergedProps.mapping).length > 0) {
    await instance.setMapping(mergedProps.mapping);
  }

  return instance;
};
