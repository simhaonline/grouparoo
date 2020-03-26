import { Profile, App, Destination, SimpleAppOptions } from "@grouparoo/core";
import { connect } from "./connect";
import * as crypto from "crypto";

export async function exportProfile(
  destination: Destination,
  app: App,
  options: SimpleAppOptions,
  profile: Profile,
  oldProfileProperties: { [key: string]: any },
  newProfileProperties: { [key: string]: any },
  oldGroups: Array<string>,
  newGroups: Array<string>,
  toDelete: boolean
) {
  const client = await connect(options);
  let response;

  // if we received no mapped data... just exit
  if (Object.keys(newProfileProperties).length === 0) {
    return;
  }

  const email_address = newProfileProperties["email_address"]; // this is a required key for mailchimp
  if (!email_address) {
    throw new Error(
      `newProfileProperties[email_address] is a required mapping`
    );
  }

  if (toDelete) {
    response = await client.delete(
      `/lists/${options.listId}/members/${generateMailchimpId(email_address)}`
    );
    return response.statusCode === 200;
  } else {
    let exists = false;
    let existingTagNames = [];

    // consider if the the email address has changed
    if (
      oldProfileProperties["email_address"] &&
      email_address !== oldProfileProperties["email_address"]
    ) {
      await client.put(
        `/lists/${options.listId}/members/${generateMailchimpId(
          oldProfileProperties["email_address"]
        )}`,
        {
          email_address,
          status: "subscribed",
          merge_fields: { email_address },
        }
      );
    }

    // the way to "erase" a merge_var in mailchimp is by setting the value to "", regardless of the merge_var type
    const mergeFields = {};
    for (const k in newProfileProperties) {
      mergeFields[k] =
        newProfileProperties[k] === null ||
        newProfileProperties[k] === undefined
          ? ""
          : newProfileProperties[k];
    }

    try {
      const getResponse = await client.get(
        `/lists/${options.listId}/members/${generateMailchimpId(email_address)}`
      );
      if (getResponse.unique_email_id) {
        exists = true;
      }

      existingTagNames = getResponse.tags.map((t) => t.name);

      // delete old merge tags
      for (const k in getResponse.merge_fields) {
        mergeFields[k] =
          newProfileProperties[k] === null ||
          newProfileProperties[k] === undefined
            ? ""
            : newProfileProperties[k];
      }
    } catch (error) {}

    // update merge_variables
    const payload = {
      email_address,
      status: "subscribed",
      merge_fields: mergeFields,
    };

    const method = exists ? "put" : "post";
    const route = exists
      ? `/lists/${options.listId}/members/${generateMailchimpId(email_address)}`
      : `/lists/${options.listId}/members`;

    await client[method](route, payload);

    const tagPayload = [];

    // add new tags
    for (const i in newGroups) {
      const tag = newGroups[i];
      if (!existingTagNames.includes(tag)) {
        tagPayload.push({ name: tag, status: "active" });
      }
    }

    // remove old tags
    for (const i in existingTagNames) {
      const existingTag = existingTagNames[i];
      if (!newGroups.includes(existingTag)) {
        tagPayload.push({ name: existingTag, status: "inactive" });
      }
    }

    await client.post(
      `/lists/${options.listId}/members/${generateMailchimpId(
        email_address
      )}/tags`,
      { tags: tagPayload }
    );

    return true;
  }
}

function generateMailchimpId(email: string) {
  let hash = crypto
    .createHash("md5")
    .update(email.toLowerCase().trim())
    .digest("hex");
  return hash;
}