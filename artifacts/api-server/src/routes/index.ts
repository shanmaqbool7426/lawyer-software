import { Router, type IRouter } from "express";
import healthRouter from "./health";
import teamRouter from "./team";
import trafficRouter, { publicRouter } from "./traffic";
import invoicesRouter from "./invoices";
import expensesRouter from "./expenses";
import appointmentsRouter from "./appointments";
import conflictCheckRouter from "./conflict-check";
import reportsRouter from "./reports";
import integrationsRouter, { googlePublicRouter } from "./integrations";
import { membership, moduleGuard } from "../middlewares/membership";

const router: IRouter = Router();

router.use(healthRouter);
// Every authenticated request is tied to a team member before it can touch a
// module. /me and /team sit ahead of the module guard because they are how the
// sidebar learns what the guard will allow.
router.use(membership);
router.use(teamRouter);
router.use(moduleGuard);
router.use(trafficRouter);
router.use(invoicesRouter);
router.use(expensesRouter);
router.use(appointmentsRouter);
router.use(conflictCheckRouter);
router.use(reportsRouter);
router.use(integrationsRouter);

export default router;
export { publicRouter, googlePublicRouter };
