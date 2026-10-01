# PM Tool — Product requirements

This document describes what PM Tool does today. It is the baseline for a reimplementation. It states what a person can do and the rules the product must follow. It does not require any particular programming language, framework, or database.

How to run the current copy is in [README.md](../README.md).

Ideas that are not in the product yet belong only in [Future features](#future-features). They are not part of the baseline.

## Purpose

PM Tool is a shared workspace for a project portfolio. It tracks people, the projects they work on, how much of each person is allocated, and written status.

There is no sign-in. Anyone who can open the workspace can view and change everything.

## Concepts

| Concept | Meaning |
| --- | --- |
| Person | Someone who can be assigned to projects. Has a name, an organization role, a unique email, an optional location, and optional notes. |
| Location | Where the person is based: KHI, ISB, or LHR. Optional until it is set. |
| Organization role | The person’s standing in the directory: Software engineer, Hardware engineer, Analog design engineer, PD engineer, or Lead. |
| Project role | The person’s role on one assignment. Separate from the organization role. |
| Group | A named family of root projects. Every root project belongs to exactly one group. |
| Root project | A top-level project. It can have sub-projects. |
| Sub-project | A project under one root. It cannot have children of its own. |
| Tag | A short label shared across projects. Used to filter the portfolio. |
| Assignment | A person on one project, with a utilization percent, a project role, and an onboarded flag. |
| Lifecycle | Where a project is: Assessment, In Progress, Closing, or Completed. |
| Status report | A free-text update on one project, with the time it was reported. |
| Reports with PMO | Whether that project’s status is reported through the PMO. On by default. |

A new root project starts in Assessment and reports with the PMO. A new assignment uses 100% utilization, the project role Member, and is not onboarded.

## Workspace

The workspace has two main areas: **People** and **Projects**. Opening the workspace lands on People.

When anyone’s assignments add up to more than 100%, a notice stays at the top of every screen. It says how many people are over-allocated. Opening it lists each person, their total, and every assignment (project, project role, and percent). The notice refreshes when utilization changes and when the user returns to the workspace. An assignment above 100% in total is allowed; the product warns, it does not block the save.

## People

A person has:

- **Name**, required and not blank.
- **Organization role**, one of Software engineer, Hardware engineer, Analog design engineer, PD engineer, or Lead.
- **Email**, required, unique, and treated as the same address regardless of letter case.
- **Location**, optional. One of KHI, ISB, or LHR. Blank means the location is not set.
- **Notes**, optional. Blank notes are stored as no notes.

From the directory a user can add, edit, or delete a person. Delete asks for confirmation. The confirmation lists each project the person is linked to, with project role and utilization, and an onboarded mark when they are onboarded. Delete is refused while the person has any assignment. After the assignments are removed, delete works.

Each person shows:

- Name, organization role, location when it is set, email, and notes.
- Total utilization, highlighted when it is over 100%.
- Each assignment: project (a sub-project is shown with its root), project role, utilization, and an onboarded mark when they are onboarded. The project name opens that project.

The directory can be searched by name or email, filtered by organization role, filtered by location, and filtered by a single project (root or sub-project). It lists the newest people first, 50 at a time. When more people match, previous and next move through the rest. It can also be ordered by name. It shows how many people match, and a count for each organization role. Those counts cover everyone who matches, including people on other pages. From the directory the user can open the [resource utilization report](#resource-utilization-report) with the same search, organization role, location, and project.

Empty directory: invite the user to add someone or import a file. Filters with no matches: say so, and do not offer “add” as if the directory were empty.

### CSV import

A user can download a template and import a UTF-8 CSV. The file must have a header row with the columns `name`, `role`, `email`, and `notes`.

- Blank rows are ignored.
- Role may be the code (`software_engineer`, `hardware_engineer`, `analog_design_engineer`, `pd_engineer`, `lead`) or the label (`Software engineer`, and so on).
- A `location` column is optional. Blank, or a file without that column, means no location. A value must be KHI, ISB, or LHR. Letter case does not matter. A bad location is a row error.
- A row with a bad name, role, or email is an error. The result names the row and the problem. Other rows still import.
- A row whose email is already in the directory, or already appeared earlier in the same file, is skipped. It is not an error.
- The result reports how many people were created, how many were skipped, and the list of row errors.

## Resource utilization report

The report lists every person who matches the current search, organization role, location, and project. Those filters, and the sort order, are kept in the page address, so a filtered report can be opened directly. The People page’s Report action opens this view with the directory’s filters.

A summary shows how many people match, how many are over 100%, and a count for each organization role.

The table is ordered by name, A to Z, unless another order is chosen. The user can order by name (either direction), organization role, email, or utilization (highest first or lowest first). People who compare equal stay in name order. The saved HTML file uses the order on screen. Each person is a row:

- Name, organization role, location, and email. A person with no location shows a blank location.
- Total utilization, highlighted when it is over 100%.
- Each assignment: project (a sub-project is shown with its root), group, project role, utilization, and an onboarded mark when they are onboarded. The project name opens that project.

A person with no assignments is still listed, at 0%, with no projects. Assignments on completed projects are included.

The on-screen report can be saved as an HTML file. The suggested file name includes the date, time, and the current filter.

## Projects and groups

The project list shows root projects only. A user can search by project name, description, group name, or tag, and can filter by one group and one tag. A tag on a sub-project matches the root as well, so filtering by that tag still shows the root. Clicking a tag on a card applies or clears that tag filter.

Roots are ordered by the latest activity in the family: the root, its sub-projects, or a status report on any of them.

Each root card shows:

- The group, as a mark the user can open to edit that group. If the group has an image, the mark shows it.
- Tags on the root.
- Lifecycle, which can be changed from the card.
- How many people are on the root and its sub-projects. The count is highlighted when the same person is assigned more than once inside that family. Hovering the count shows names. Opening it lists each assignment in the family: person, project, project role, utilization, onboarded, and whether that person is duplicated in the family.
- The root name, which opens the project.
- Each sub-project, with its own tags and people count. A sub-project with no people shows no count. See [Report freshness on the list](#report-freshness-on-the-list).
- When the family was last updated.

A root with no sub-projects still shows a “No sub-projects” line, colored with the root’s own report freshness.

The list states how many root projects match. No projects yet: invite the user to create one. Filters with no matches: say that nothing matches the search, group, or tag.

From the list the user can open the [portfolio report](#portfolio-report) with the same search, group, and tag, or [export the matching projects](#project-data-export).

### Creating a root project

A root needs a name and a group. Description, lifecycle, and tags are optional; lifecycle defaults to Assessment. The user can pick an existing group or type a new name. Typing a name that already exists, ignoring letter case, uses that group. A blank group name is rejected.

### Groups

A group exists because at least one root project names it. It is created when that name is first used. It is removed, including its image, when it no longer has any root projects (the last root was deleted or moved to another group name).

Group names are unique regardless of letter case. Renaming a group to a name another group already has is rejected. Renaming is done from the group mark on a project card, and it changes the group for every root that belongs to it.

A group may have one image, shown on its project tiles: PNG, JPEG, WEBP, or GIF, up to 2 MB. Uploading a new image replaces the previous one.

### Sub-projects

A sub-project has a name. Description, lifecycle, and tags are optional. It is created from its root. It inherits that root’s group and cannot be given a different group.

A sub-project cannot have sub-projects. The hierarchy is one level only.

A sub-project can be moved to a different root. It then belongs to that root’s group. It cannot be moved onto itself, onto another sub-project, or left where it already is.

Deleting a root deletes its sub-projects, their assignments, their tags, and their status reports. Deleting a sub-project deletes only that sub-project. If the root’s group is then empty, the group is removed. Tags that are no longer used anywhere are removed.

### Project detail

Opening a project shows a path back to the list. A sub-project also links to its root and names that root.

The user can edit:

- Name.
- Group, on a root only. Changing the name follows the same create-or-reuse rule as a new project. A sub-project shows the inherited group and cannot change it.
- Lifecycle.
- Whether reporting is with the PMO. This saves as soon as it is toggled.
- Description.
- Chat URL, optional. A web address (`http` or `https`) can be opened. Clearing the field removes the link.
- Tags. See [Tags](#tags).

On a root, the user can add a sub-project and can change each sub-project’s lifecycle, see its people count and tags, and move it.

Delete asks for confirmation, then removes the project as described above.

## Assignments

On a project, the user can add a person who is not already on that project. Adding sets utilization (0–100), project role, and onboarded. The picker can search people by name.

The same person may be on many projects, including a root and its sub-projects, or more than one sub-project of the same root.

On the project, each assignment can be changed on its own:

- Onboarded, toggled directly.
- Project role.
- Utilization, from 0 through 100.
- Remove, which drops the person from that project only.

Project roles are: Member, Lead, Director, DV engineer, RTL engineer, Software engineer, and Firmware engineer. On the project, Directors are listed first, then Leads, then everyone else, and within each group people are ordered by name.

A person assigned to more than one project in the same root family (the root and its sub-projects) is a **duplicate** for that family. The project list marks the family’s people count and those names. This is a warning, not a block.

## Tags

A tag is a name, at most 64 characters, after extra spaces are collapsed. A project can have at most 20 tags. The same name on one project is kept once. Matching ignores letter case, so “Alpha” and “alpha” are one tag, and the existing spelling is kept.

Tags are suggested from names already in use. A tag that is no longer on any project disappears.

On the project list and in the portfolio report, filtering by a tag includes a root when the tag is on the root or on any of its sub-projects. Filtering a sub-project’s own tags is what makes its root appear.

## Status reports

Every project, root or sub-project, has its own report history.

A report is required text plus the time it was reported. The time can be chosen when the report is added and can be changed later. The text can be edited. A report can be deleted. The history is newest first, and long histories are paged.

Opening a report shows the full text. The list shows a shortened view of the text and the reported time.

### Report freshness on the list

On a project card, each sub-project (and the “No sub-projects” line) is marked from that project’s own flag and latest report:

- Reporting is not with the PMO: marked as not with the PMO. Age is ignored.
- Latest report is today: marked as updated today.
- Latest report is within 7 days: marked as fresh.
- Latest report is 7 days old or older: marked as stale.
- No report, and reporting is with the PMO: no freshness mark.

“Today” and “7 days” use calendar dates, not elapsed hours.

## Portfolio report

The report is a portfolio view of the root projects that match the current search, group, and tag. Those three filters are kept in the page address, so a filtered report can be opened directly. The project list’s Report action opens this view with the list’s filters.

The report has two parts.

**Summary by group.** One row per group that has at least one matching root: group name, number of those roots, number of people on those families, and a note about sharing. A person in the group who also has an assignment in another group is counted as shared, with a way to see which other projects. The rest are unique to the group. A total row counts the roots and the distinct people across the summary.

**One table per group.** Each matching root is a row:

- Project name, with its sub-projects listed under it when it has any.
- Description. Empty descriptions read as not available. Long text is shortened on screen, with a way to read the full description. A full export of the page includes the complete text.
- Engineering resources: how many people are on that root and its sub-projects. If some of those people also have an assignment outside that family, the row splits them into unique and shared, and the shared count can show the other projects. The same split exists for a sub-project against assignments outside that sub-project. Counts can be opened to list the people and, for each person, the projects and utilization.
- Lifecycle (called State in the report).
- Latest status. If the project does not report with the PMO, the cell says status is not available because reporting is not with the PMO. Otherwise it shows the latest report, shortened the same way as a description, with the full text available. A report more than a week old is marked stale, with the reported time.

The on-screen report can be saved as an HTML file. The suggested file name includes the date, time, and the current filter.

## Project data export

From the project list, export downloads the roots that match the current search, group, and tag. The user can set the file name and how many of the most recent status reports to include for each project and sub-project (0 through 100).

The file is one record per root project. Each record includes the root, its people, its sub-projects, tags, and the chosen status reports for the root and for each sub-project.

## Rules that always hold

- Email addresses are unique.
- A person is on a given project at most once.
- Utilization on one assignment is an integer from 0 through 100. The sum across projects may exceed 100.
- A root project has a group. A sub-project uses its root’s group.
- A sub-project’s parent is always a root project.
- Deleting a project deletes its assignments, status reports, and, for a root, its sub-projects.
- Deleting a person deletes their assignments.
- Groups and tags that nothing uses anymore are removed.
- Over-allocation and duplicate people inside a family are visible. Neither one prevents the assignment.

## Future features

Add new ideas below this line. Do not fold them into the sections above until they are part of the product. Each idea should be a short requirement, not an implementation note.

Copy this block for each idea:

### Feature name

- **Who it is for:**
- **Behavior:**
- **Rules:**
- **Out of scope:**
