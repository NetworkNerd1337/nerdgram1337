# Schema compatibility

Network JSON stays on schemaVersion 1 when a change only adds optional fields, and moves to 2 when a field's meaning changes.

[Back to the documentation index](../README.md)

## Contents

- [Decision](#decision)
- [Stay on 1](#stay-on-1)
- [Bump to 2](#bump-to-2)
- [Closed schema](#closed-schema)
- [Which release reads the file](#which-release-reads-the-file)

## Decision

The schema in this folder is [network.schema.json](network.schema.json). `schemaVersion` is required, and this file sets it to the number 1. `format`, when it is present, is `"network"`. The `$id` is `https://nerdgram1337.local/schema/network-v1.schema.json`. That name is version 1 of this document. While `schemaVersion` stays 1, the `$id` stays on `network-v1`.

The number on a file names the meanings of the fields in that file. Version 1 is the meanings in the schema today. NerdGram accepts only `schemaVersion` 1. Any other number fails with `schemaVersion must be 1.` Version 2 is the number a later change uses when a meaning changes. This page is that rule. Version 2 becomes valid when that change ships.

| Change | What happens |
| --- | --- |
| Add an optional field. A file that omits it still validates, and every field it already uses keeps the same meaning. | Stay on `schemaVersion` 1. |
| Add an allowed value older files do not use, while every value they already use means the same thing. | Stay on `schemaVersion` 1. |
| Change the type, the name, or the requiredness of a field that already exists. | Bump `schemaVersion` to 2. |
| Change what a value the field already accepts means. | Bump `schemaVersion` to 2. |
| Remove a field. | Bump `schemaVersion` to 2. |
| Send a property the schema does not list. | The file is invalid. The schema stays closed. |

## Stay on 1

Leave the number at 1 when older files still validate without edits, and every field those files already use still means the same thing.

Add the new optional field to [network.schema.json](network.schema.json) and to `validateNetwork()` in the same change. A file that omits the field is still valid version 1. An optional device model, or an optional speed on an interface, is this kind of change once the schema lists that field.

A new allowed value on a field that already exists stays on 1 when older files never have to send it, and the values they already send still mean what they mean today. The `$id` stays `network-v1`.

## Bump to 2

Set `schemaVersion` to 2 when a field that already exists changes meaning. A document that still uses today's meanings stays on 1. A document that uses the new meaning says 2, and the version 2 schema gets a new `$id`. The version 1 schema and its `$id` stay the record of today's meanings.

These are meaning changes:

- The type changes. A string becomes an object, or a number becomes a string.
- The field is renamed, or removed.
- Requiredness changes. A missing value used to be an error and is now data, or a version 1 file that omitted the field would now fail.
- A value the field already accepts means something else. An existing enum token, an existing number, or an existing unit changes what NerdGram does with it.

Renaming `platform`, or making `managementIp` required, is a bump to 2. The version 1 file keeps today's meaning of those fields.

## Closed schema

The document is a closed object. `additionalProperties` is false on the root and on every object under `$defs`. `validateNetwork()` allows the same names. A property the schema does not name is an error, and the error names the path, for example `/devices/0/serial: unexpected property "serial".`

A new key is accepted only after the schema lists it. Until that change, the key is an error on version 1. Listing it as an optional field is a stay-on-1 change. Unknown properties stay errors.

## Which release reads the file

A file that uses a key added in NerdGram 1.5 needs NerdGram 1.5 or later. An earlier release rejects that key, because its schema is closed and does not list the key.

A file that omits those keys stays on `schemaVersion` 1 and keeps working. That includes a file written before the key existed, and a new file that leaves the key out. The diagram from a file that omits the new keys stays the diagram that file already produced.

## See also

- [Generate from data](../generate-from-data.md)
- [Network schema file](network.schema.json)
- [Roadmap](../roadmap.md#150-canonical-json-and-one-upsert)
