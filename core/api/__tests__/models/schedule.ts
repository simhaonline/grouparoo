import { helper } from "../utils/specHelper";
import { App } from "../../src/models/App";
import { Log } from "../../src/models/Log";
import { Schedule } from "../../src/models/Schedule";
import { Source } from "../../src/models/Source";
import { Option } from "../../src/models/Option";
import { Run } from "../../src/models/Run";
import { plugin } from "../../src/modules/plugin";
let actionhero, api;

describe("models/schedule", () => {
  beforeAll(async () => {
    const env = await helper.prepareForAPITest();
    actionhero = env.actionhero;
    api = env.api;
  }, 1000 * 30);

  afterAll(async () => {
    await helper.shutdown(actionhero);
  });

  describe("with source", () => {
    let app: App;
    let source: Source;

    beforeAll(async () => {
      await helper.factories.profilePropertyRules();

      app = await App.create({
        name: "test app",
        type: "test-plugin-app",
        options: { fileGuid: "abc123" },
      });

      source = await Source.create({
        name: "test source",
        type: "test-plugin-import",
        appGuid: app.guid,
      });
    });

    test("a schedule can be created with a source, and it can find the related app", async () => {
      const schedule = new Schedule({
        name: "test schedule",
        type: "test-plugin-import",
        sourceGuid: source.guid,
      });

      await schedule.save();

      expect(schedule.guid.length).toBe(40);
      expect(schedule.createdAt).toBeTruthy();
      expect(schedule.updatedAt).toBeTruthy();

      const options = await schedule.getOptions();
      expect(options).toEqual({});

      const _source = await schedule.$get("source");
      const _app = await _source.$get("app");
      expect(_app.guid).toBe(app.guid);
      await schedule.destroy();
    });

    test("creating a schedule creates a log entry", async () => {
      const latestLog = await Log.findOne({
        where: { verb: "create", topic: "schedule" },
        order: [["createdAt", "desc"]],
        limit: 1,
      });

      expect(latestLog).toBeTruthy();
    });

    test("deleting a schedule creates a log entry", async () => {
      const schedule = await Schedule.create({
        name: "bye schedule",
        type: "test-plugin-import",
        sourceGuid: source.guid,
      });

      await schedule.destroy();

      const latestLog = await Log.findOne({
        where: { verb: "create", topic: "schedule" },
        order: [["createdAt", "desc"]],
        limit: 1,
      });

      expect(latestLog).toBeTruthy();
    });

    describe("validations", () => {
      test("options must match the app options (extra options needed by app)", async () => {
        const schedule = new Schedule({
          name: "incoming schedule - too many options",
          type: "test-plugin-import",
          sourceGuid: source.guid,
        });

        await schedule.save();
        expect(schedule.guid).toBeTruthy();

        await expect(
          schedule.setOptions({ maxColumn: "abc", something: "abc123" })
        ).rejects.toThrow(
          /something is not an option for a test-plugin-import schedule/
        );

        await schedule.destroy();
      });

      test("recurring schedules require a recurring frequency > 1 minute", async () => {
        const schedule = await helper.factories.schedule();
        await expect(
          schedule.update({ recurring: true, recurringFrequency: 0 })
        ).rejects.toThrow(
          /recurring frequency is required to be one minute or greater/
        );

        await expect(
          schedule.update({ recurring: true, recurringFrequency: null })
        ).rejects.toThrow(
          /recurring frequency is required to be one minute or greater/
        );

        schedule.update({ recurring: true, recurringFrequency: 1000 * 60 }); // OK
        await schedule.destroy();
      });
    });

    test("creating 2 schedules for the same source will throw an error", async () => {
      const scheduleA = new Schedule({
        name: "incoming schedule A",
        type: "test-plugin-import",
        sourceGuid: source.guid,
      });
      await scheduleA.save();

      const scheduleB = new Schedule({
        name: "incoming schedule B",
        type: "test-plugin-import",
        sourceGuid: source.guid,
      });
      await expect(scheduleB.save()).rejects.toThrow(/already has a schedule/);

      await scheduleA.destroy();
    });

    test("options can be set and retrieved", async () => {
      const schedule = await Schedule.create({
        name: "incoming schedule A",
        type: "test-plugin-import",
        sourceGuid: source.guid,
      });

      await schedule.setOptions({ maxColumn: "id" });
      const options = await schedule.getOptions();
      expect(options).toEqual({ maxColumn: "id" });

      await schedule.destroy();
    });

    test("deleting a schedule deleted the options", async () => {
      const schedule = await Schedule.create({
        name: "incoming schedule A",
        type: "test-plugin-import",
        sourceGuid: source.guid,
      });

      await schedule.setOptions({ maxColumn: "abc" });

      await schedule.destroy(); // doesn't throw

      const optionsCount = await Option.count({
        where: { ownerGuid: schedule.guid },
      });
      expect(optionsCount).toBe(0);
    });

    test("providing invalid options will result in an error", async () => {
      const schedule = await Schedule.create({
        name: "incoming schedule A",
        type: "test-plugin-import",
        sourceGuid: source.guid,
      });

      await expect(schedule.setOptions({ notThing: "abc" })).rejects.toThrow(
        /maxColumn is required for a schedule of type test-plugin-import/
      );

      await expect(
        schedule.setOptions({ maxColumn: "abc", otherThing: "false" })
      ).rejects.toThrow(
        /otherThing is not an option for a test-plugin-import schedule/
      );

      await schedule.destroy();
    });
  });

  describe("with custom plugin", () => {
    let app: App;
    let source: Source;

    beforeAll(async () => {
      plugin.registerPlugin({
        name: "test-plugin",
        apps: [
          {
            name: "test-template-app",
            options: [],
            test: async () => {
              return true;
            },
          },
        ],
        connections: [
          {
            name: "import-from-test-template-app",
            description: "a test app connection",
            app: "test-template-app",
            direction: "import" as "import",
            options: [],
            scheduleOptions: [
              {
                key: "maxColumn",
                required: true,
                description: "the column to choose",
                type: "list",
                options: async () => {
                  return [
                    { key: "created_at", examples: [1, 2, 3] },
                    { key: "updated_at", examples: [1, 2, 3] },
                  ];
                },
              },
            ],
            methods: {
              profiles: async () => {
                return { nextHighWaterMark: "100", importsCount: 100 };
              },
              nextFilter: async () => {
                return { highPoint: "abc" };
              },
            },
          },
        ],
      });

      app = await App.create({
        name: "test app with real methods",
        type: "test-template-app",
      });

      source = await Source.create({
        name: "test source",
        type: "import-from-test-template-app",
        appGuid: app.guid,
      });
    });

    test("schedules can retrieve their options from the source", async () => {
      const schedule = await Schedule.create({
        name: "test plugin schedule",
        sourceGuid: source.guid,
      });

      const pluginOptions = await schedule.pluginOptions();
      expect(pluginOptions).toEqual([
        {
          description: "the column to choose",
          key: "maxColumn",
          options: [
            { examples: [1, 2, 3], key: "created_at" },
            { key: "updated_at", examples: [1, 2, 3] },
          ],
          required: true,
          type: "list",
        },
      ]);

      await schedule.destroy();
    });

    test("running a schedule will save the filter and highWaterMark on the run", async () => {
      const schedule = await Schedule.create({
        name: "test plugin schedule",
        sourceGuid: source.guid,
      });

      const run = await Run.create({
        creatorGuid: schedule.guid,
        creatorType: "schedule",
        state: "running",
      });

      await schedule.run(run, 0, 0);
      await run.reload();
      expect(run.highWaterMark).toBe("100");
      expect(run.filter).toEqual({ highPoint: "abc" });

      await schedule.destroy();
    });

    test("a source using a plugin with no profiles method cannot have a schedule", async () => {
      expect(source.scheduleAvailable()).toBe(true);

      // delete the profiles method
      const plugin = api.plugins.plugins.filter(
        (p) => p.name === "test-plugin"
      )[0];
      delete plugin.connections[0].methods.profiles;
      expect(source.scheduleAvailable()).toBe(false);

      await expect(
        Schedule.create({
          name: "test plugin schedule",
          sourceGuid: source.guid,
        })
      ).rejects.toThrow(/cannot have a schedule/);
    });
  });
});