import { Router } from 'express';
import * as agents from '../controllers/customAgentController.js';
import { requireAuth } from '../middleware/auth.js';
import { validateBody } from '../middleware/validate.js';

const router = Router();

router.use(requireAuth);

router.get('/', agents.list);
router.post('/', validateBody(agents.createSchema), agents.create);
router.patch('/:id', validateBody(agents.updateSchema), agents.update);
router.delete('/:id', agents.remove);

// Entries are addressed by slug because that is what the URL in the app uses.
router.get('/:slug/entries', agents.detail);
router.post('/:slug/entries', validateBody(agents.entrySchema), agents.createEntry);
router.patch('/entries/:id', validateBody(agents.entryUpdateSchema), agents.updateEntry);
router.delete('/entries/:id', agents.removeEntry);

export default router;
