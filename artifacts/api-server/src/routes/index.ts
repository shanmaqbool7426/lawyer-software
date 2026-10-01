import { Router, type IRouter } from "express";
import healthRouter from "./health";
import trafficRouter, { publicRouter } from "./traffic";
import invoicesRouter from "./invoices";
import expensesRouter from "./expenses";
import appointmentsRouter from "./appointments";
import conflictCheckRouter from "./conflict-check";

const router: IRouter = Router();

router.use(healthRouter);
router.use(trafficRouter);
router.use(invoicesRouter);
router.use(expensesRouter);
router.use(appointmentsRouter);
router.use(conflictCheckRouter);

export default router;
export { publicRouter };
