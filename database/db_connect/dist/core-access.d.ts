import type { ActorContext } from "./actor-context";
import type { DbTx } from "./pool";
/** Proves student ownership or institution scope using canonical actor data and enrolment joins. */
export declare function assertStudentReadable(tx: DbTx, actor: ActorContext, studentId: string): Promise<void>;
export declare function enrolmentScopePredicate(actor: ActorContext, alias?: string, parameterIndex?: number): {
    sql: string;
    values: unknown[];
};
