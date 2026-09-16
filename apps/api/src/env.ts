/**
 * ローカル開発用の環境変数ロード。**app より先に import すること**
 * （ESM の import は宣言順に評価されるので副作用の順序は保証される）。
 * Vercel では環境変数がプラットフォームから入るので .env は存在せず、何もしない。
 */
import { config } from 'dotenv'

config({ path: ['.env.local', '../../.env.local'], quiet: true })
