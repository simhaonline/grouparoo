import { helper } from "../../utils/specHelper";
import { task, specHelper } from "actionhero";
import { Profile } from "./../../../src/models/Profile";
import { Import } from "./../../../src/models/Import";
import { App } from "./../../../src/models/App";
import { Group } from "./../../../src/models/Group";
import { Destination } from "./../../../src/models/Destination";
import { Export } from "./../../../src/models/Export";
import { plugin } from "../../../src/modules/plugin";

let actionhero, api;

describe("tasks/profile:export", () => {
  beforeAll(async () => {
    const env = await helper.prepareForAPITest();
    actionhero = env.actionhero;
    api = env.api;
    await api.resque.queue.connection.redis.flushdb();
  }, 1000 * 30);

  afterAll(async () => {
    await helper.shutdown(actionhero);
  });

  describe("profile:export", () => {
    test("can be enqueued", async () => {
      await task.enqueue("profile:export", { guid: "abc123" });
      const found = await specHelper.findEnqueuedTasks("profile:export");
      expect(found.length).toEqual(1);
    });

    test("enqueuing more than one tasks for the same profile will de-duplicate", async () => {
      await task.enqueue("profile:export", { guid: "abc123" });
      await task.enqueue("profile:export", { guid: "abc123" });

      const found = await specHelper.findEnqueuedTasks("profile:export");
      expect(found.length).toEqual(1);
    });

    test("enqueuing more tasks for different profiles is OK", async () => {
      await task.enqueue("profile:export", { guid: "abc123" });
      await task.enqueue("profile:export", { guid: "cde456" });

      const found = await specHelper.findEnqueuedTasks("profile:export");
      expect(found.length).toEqual(2);
    });

    describe("with multiple destinations and imports", () => {
      let profile: Profile;
      let group: Group;
      let app: App;
      let destination: Destination;

      beforeAll(async () => {
        await helper.truncate();
        await helper.factories.profilePropertyRules();
        helper.disableTestPluginImport();

        profile = await helper.factories.profile();
        await profile.addOrUpdateProperties({ email: "mario@example.com" });

        group = await helper.factories.group({
          name: "test group",
          type: "manual",
          matchType: "all",
        });
        await group.addProfile(profile);

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
              direction: "export",
              options: [],
              methods: {
                exportProfile: async () => {
                  return true;
                },
              },
            },
          ],
        });

        app = await App.create({
          name: "test app",
          type: "test-template-app",
        });

        destination = await Destination.create({
          name: "test destination",
          type: "import-from-test-template-app",
          appGuid: app.guid,
        });
        await destination.setMapping({
          email: "email",
          firstName: "firstName",
          lastName: "lastName",
        });
        await destination.trackGroup(group);
        await destination.update({ state: "ready" });

        await api.resque.queue.connection.redis.flushdb();
      });

      beforeEach(async () => {
        await api.resque.queue.connection.redis.flushdb();
        await Import.destroy({ truncate: true });
        await Export.destroy({ truncate: true });
      });

      it("updates the run and imports", async () => {
        let profiles = await Profile.findAll();
        expect(profiles.length).toBe(1);

        const runA = await helper.factories.run(null, { state: "running" });
        const runB = await helper.factories.run(null, { state: "running" });

        const importA = await helper.factories.import(runA, {
          email: "mario@example.com",
          firstName: "Mario",
          lastName: "Mario",
        });

        const importB = await helper.factories.import(runB, {
          email: "mario@example.com",
          firstName: "Super",
        });

        const foundAssociateTasks = await specHelper.findEnqueuedTasks(
          "import:associateProfile"
        );
        expect(foundAssociateTasks.length).toEqual(2);

        await Promise.all(
          foundAssociateTasks.map(async (t) =>
            specHelper.runTask("import:associateProfile", t.args[0])
          )
        );

        profiles = await Profile.findAll();
        expect(profiles.length).toBe(1);

        const foundImportAndUpdateTasks = await specHelper.findEnqueuedTasks(
          "profile:importAndUpdate"
        );
        expect(foundImportAndUpdateTasks.length).toEqual(1);

        await specHelper.runTask(
          "profile:importAndUpdate",
          foundImportAndUpdateTasks[0].args[0]
        );

        const foundExportTasks = await specHelper.findEnqueuedTasks(
          "profile:export"
        );
        expect(foundExportTasks.length).toEqual(1);

        await specHelper.runTask("profile:export", foundExportTasks[0].args[0]);

        await runA.reload();
        await runB.reload();
        expect(runA.profilesExported).toBe(1);
        expect(runB.profilesExported).toBe(1);

        const _exports = await Export.findAll();
        expect(_exports.length).toBe(1);
        const _export = _exports[0];
        const exportedImports = await _export.$get("imports");
        expect(exportedImports.length).toBe(2);
        expect(exportedImports.map((e) => e.guid).sort()).toEqual(
          [importA, importB].map((e) => e.guid).sort()
        );

        expect(_export.destinationGuid).toBe(destination.guid);
        expect(_export.profileGuid).toBe(profile.guid);
        expect(_export.completedAt).toBeTruthy();
        expect(_export.oldProfileProperties).toEqual({
          email: "mario@example.com",
          firstName: null,
          lastName: null,
        });
        expect(_export.newProfileProperties).toEqual({
          email: "mario@example.com",
          firstName: "Super",
          lastName: "Mario",
        });
        expect(_export.oldGroups).toEqual(["test group"]);
        expect(_export.newGroups).toEqual(["test group"]);

        await importA.reload();
        await importB.reload();
        expect(importA.exportedAt).toBeTruthy();
        expect(importB.exportedAt).toBeTruthy();
      });

      test("it will append destinationGuids from imports", async () => {
        const run = await helper.factories.run();
        const _import = await helper.factories.import(run, {
          email: "bowser@example.com", // create a new profile, not in the group
          firstName: "Bowser",
          lastName: "Koopa",
          _meta: {
            destinationGuid: destination.guid,
          },
        });

        const foundAssociateTasks = await specHelper.findEnqueuedTasks(
          "import:associateProfile"
        );
        expect(foundAssociateTasks.length).toEqual(1);

        await Promise.all(
          foundAssociateTasks.map(async (t) =>
            specHelper.runTask("import:associateProfile", t.args[0])
          )
        );

        const profiles = await Profile.findAll();
        expect(profiles.length).toBe(2);

        const foundImportAndUpdateTasks = await specHelper.findEnqueuedTasks(
          "profile:importAndUpdate"
        );
        expect(foundImportAndUpdateTasks.length).toEqual(1);

        await specHelper.runTask(
          "profile:importAndUpdate",
          foundImportAndUpdateTasks[0].args[0]
        );

        const foundExportTasks = await specHelper.findEnqueuedTasks(
          "profile:export"
        );
        expect(foundExportTasks.length).toEqual(1);

        await specHelper.runTask("profile:export", foundExportTasks[0].args[0]);

        const _exports = await Export.findAll();
        expect(_exports.length).toBe(1);
        const _export = _exports[0];
        const exportedImports = await _export.$get("imports");
        expect(exportedImports.length).toBe(1);
        expect(exportedImports[0].guid).toBe(_import.guid);

        expect(_export.destinationGuid).toBe(destination.guid);
        expect(_export.profileGuid).not.toBe(profile.guid);
        expect(_export.completedAt).toBeTruthy();
        expect(_export.oldProfileProperties).toEqual({
          email: "bowser@example.com",
        });
        expect(_export.newProfileProperties).toEqual({
          email: "bowser@example.com",
          firstName: "Bowser",
          lastName: "Koopa",
        });
        expect(_export.oldGroups).toEqual([]);
        expect(_export.newGroups).toEqual([]);
      });

      describe("errors", () => {
        let counter = 0;

        beforeAll(() => {
          Destination.prototype.exportProfile = jest.fn(() => {
            counter++;
            throw new Error("oh no");
          });
        });

        it("applies errors to the imports and export", async () => {
          const run = await helper.factories.run();
          const _import = await Import.create({
            creatorType: "run",
            creatorGuid: run.guid,
            profileGuid: profile.guid,
            profileUpdatedAt: new Date(),
            groupsUpdatedAt: new Date(),
            data: {},
            oldGroupGuids: [],
            newGroupGuids: [group.guid],
          });

          await expect(
            specHelper.runTask("profile:export", {
              guid: profile.guid,
            })
          ).rejects.toThrow(/oh no/);

          expect(counter).toBe(1);

          await _import.reload();
          expect(_import.errorMessage).toMatch(/oh no/);
          const errorMetadata = JSON.parse(_import.errorMetadata);
          expect(errorMetadata.message).toMatch(/oh no/);
          expect(errorMetadata.step).toBe("profile:export");
          expect(errorMetadata.stack).toMatch(/ProfileExport/);
        });
      });
    });
  });
});
