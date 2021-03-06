import faker from "faker";
import { App } from "./../../src/models/App";

const data = async (props = {}) => {
  const defaultProps = {
    name: `${faker.name.jobDescriptor()}-${Math.random()}`,
    type: "test-plugin-app",
    options: { fileGuid: faker.finance.bitcoinAddress() },

    createdAt: new Date(),
    updatedAt: new Date(),
  };

  return Object.assign({}, defaultProps, props);
};

export default async (props = {}) => {
  const mergedProps = await data(props);
  const instance = await App.create(mergedProps);

  if (Object.keys(mergedProps.options).length > 0) {
    await instance.setOptions(mergedProps.options);
  }

  return instance;
};
