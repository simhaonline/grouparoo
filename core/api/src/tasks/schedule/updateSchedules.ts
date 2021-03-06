import { Task, task } from "actionhero";
import { Schedule } from "../../models/Schedule";
import { Run } from "../../models/Run";

export class UpdateSchedules extends Task {
  constructor() {
    super();
    this.name = "schedule:updateSchedules";
    this.description = "check all schedules and run them if it is time";
    this.frequency = 1000 * 60 * 2; // Run every 2 minutes
    this.queue = "schedules";
  }

  async run() {
    const schedules = await Schedule.findAll({
      where: { recurring: true, state: "ready" },
    });

    for (const i in schedules) {
      const schedule = schedules[i];

      if (!schedule.recurringFrequency || schedule.recurringFrequency < 1) {
        continue;
      }

      const runningRuns = await Run.count({
        where: {
          creatorGuid: schedule.guid,
          creatorType: "schedule",
          state: "running",
        },
      });

      if (runningRuns > 0) {
        continue;
      }

      const lastCompleteRun = await Run.findOne({
        where: {
          creatorGuid: schedule.guid,
          creatorType: "schedule",
          state: "complete",
        },
        order: [["updatedAt", "desc"]],
      });

      let delta = 0;
      if (lastCompleteRun) {
        delta = new Date().getTime() - lastCompleteRun.updatedAt.getTime();
      }

      if (!lastCompleteRun || delta > schedule.recurringFrequency) {
        await task.enqueue("schedule:run", { scheduleGuid: schedule.guid });
      }
    }
  }
}
