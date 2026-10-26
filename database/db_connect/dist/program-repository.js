"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.getProgramById = getProgramById;
exports.listProgramsByInstitution = listProgramsByInstitution;
const pool_1 = require("./pool");
const master_access_1 = require("./master-access");
const authorization_1 = require("./authorization");
const versioned_cache_1 = require("./versioned-cache");
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const READ = "master.program.read";
const INST_READ = "master.institution.read";
const SQL = `SELECT p.program_id::text AS "programId", p.institution_id::text AS "institutionId", p.aicte_course_id AS "aicteCourseId", p.program_level::text AS "programLevel", p.program_shift::text AS "programShift", p.program_broad_discipline AS "broadDiscipline", p.course_name AS "courseName", p.duration_years::numeric AS "durationYears", p.is_nba_accredited AS "nbaAccredited", p.nba_valid_upto AS "nbaValidUpto", p.is_active AS "isActive" FROM master.institutional_programs p`;
function validate(actor, id) { if (!actor || !UUID.test(actor.actorUserId) || !actor.requestId?.trim() || actor.requestId.length > 100 || !UUID.test(id))
    throw new TypeError("Invalid program lookup input."); }
function map(row) { return { programId: row.programId, institutionId: row.institutionId, aicteCourseId: row.aicteCourseId, programLevel: row.programLevel, programShift: row.programShift, broadDiscipline: row.broadDiscipline, courseName: row.courseName, durationYears: row.durationYears, nbaAccredited: row.nbaAccredited, nbaValidUpto: row.nbaValidUpto, isActive: row.isActive }; }
async function authorized(actor, permission, resource, fn) {
    if (!UUID.test(actor.actorUserId) || !actor.requestId?.trim() || actor.requestId.length > 100)
        throw new TypeError("Valid authenticated actor context is required.");
    return (0, pool_1.withActorTx)({ actorUserId: actor.actorUserId.toLowerCase(), requestId: actor.requestId }, tx => (0, master_access_1.withMasterResourceAuthorization)(tx, actor.actorUserId, permission, resource, async (authorizedTx, authorizedResource) => {
        if (authorizedResource.kind !== resource.kind)
            throw new authorization_1.AuthorizationError("INVALID_RESOURCE_SCOPE");
        return fn(authorizedTx, authorizedResource.id.toLowerCase());
    }));
}
async function getProgramById(input) {
    validate(input, input.programId);
    const id = input.programId.toLowerCase();
    const namespace = { schema: "master", resource: "program", identifier: id };
    return authorized(input, READ, { kind: "program", id }, async (tx, authorizedId) => (0, versioned_cache_1.getOrSetVersioned)(namespace, 300, async () => {
        const result = await tx.query(`${SQL} WHERE p.program_id = $1::uuid`, [authorizedId]);
        if (!result.rows[0])
            throw new authorization_1.AuthorizationError("FORBIDDEN");
        return map(result.rows[0]);
    }));
}
async function listProgramsByInstitution(input) {
    validate(input, input.institutionId);
    const limit = input.limit ?? 100, offset = input.offset ?? 0;
    if (!Number.isInteger(limit) || limit < 1 || limit > 500 || !Number.isInteger(offset) || offset < 0 || offset > 100_000)
        throw new RangeError("Invalid program page bounds.");
    const institutionId = input.institutionId.toLowerCase();
    return authorized(input, INST_READ, { kind: "institution", id: institutionId }, async (tx, authorizedId) => {
        const result = await tx.query(`${SQL} WHERE p.institution_id = $1::uuid ORDER BY p.course_name, p.program_id LIMIT $2 OFFSET $3`, [authorizedId, limit, offset]);
        return result.rows.map(map);
    });
}
