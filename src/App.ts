import { createServer, Server } from 'http'
import { Client } from 'pg'

import express from 'express'
import session from 'express-session'
import connectReddis from 'connect-redis'

import * as path from 'path'
import bodyParser from 'body-parser'
import axios, { AxiosResponse, AxiosError } from 'axios'
import redis from 'redis'
import fs from 'fs'

import mustache from 'mustache'

// All main parsing imports
import { Parsing } from './Parsing'

const client = redis.createClient(process.env.REDIS_URL)
const RedisStore = connectReddis(session)



const pgClient = new Client({
  connectionString: process.env.DATABASE_URL,
  ssl: true,
})

const MasterTemplate = fs.readFileSync(path.resolve(__dirname, 'templates/Master.html'), 'utf8')

class App{
  public server: Server
  public app: express.Application
  public parsing: Parsing = new Parsing()
  constructor () {
    // App Express
    this.app = express()
    // Use bodyparser
    this.app.use(bodyParser.json());
    this.app.use(bodyParser.urlencoded({ extended: true }));

    // Use express session
    this.app.use(session({
      store: new RedisStore({client: client}),
      secret: process.env.SECRET, 
      resave: false, 
      saveUninitialized: true
    }))

    // Load static files
    this.app.use(express.static(path.resolve(__dirname, '../view')))
    // Review routes
    this.reviewRoutes()
    // Article routes
    this.articleRoutes()
    // Dashboard routes
    this.dashboardRoutes()
    // General routes. THIS SHOULD ALWAYS BE THE LAST ROUTES MOUNTED
    this.generalRoutes()

    // Http Server
    this.server = createServer(this.app)

    // Postgres connection
    pgClient.connect()
    // Redis connection error test
    /*client.on('error', (err: any)=>{
      console.log('Something went wrong on redis ', err)
    })*/
  }

  /**
   * All routes related to articles are defined here.
   * @param {express.Router} router - Router, new instance of expres.Router() by default.
   */
  articleRoutes(router: express.Router = express.Router()) {
    router.get('/json/articulo/:article', (req: express.Request, res: express.Response) => {
      const article = replaceAll(req.params.article, '_', ' ')
      pgClient.query(`SELECT * FROM public."ARTICLE" WHERE "headline" = '${article}'`, (error, result) => {
        if (error) {
          res.status(500).send(error)
        } else {
          res.status(200).send(result.rows[0])
        }
      })
    })

    router.get('/articulo/:article', (req: express.Request, res: express.Response) => {
      let wrapper: string
      let metaTags: string
      const pArticle = replaceAll(req.params.article, '_', ' ')

      pgClient.query(`UPDATE public."ARTICLE" SET "views" = "views" + 1 WHERE "headline" = '${pArticle}'; SELECT * FROM public."ARTICLE" WHERE "headline" = '${pArticle}';`, (error, result: any) => {
        if (error) {
          res.status(500).send(error)
        } else {
          if (result[1].rowCount > 0) {
            console.log(`Articulo visitado: ${pArticle}`)
            
            const article = result[1].rows[0]
            wrapper = this.parsing.parseArticle(article.headline, article.subhead, article.body, article.date, article.author)
            if (article.body.includes('src="')){
              for (let i = 0; i < article.body.length; i++){
                if (article.body[i] == '"'){
                  let string = article.body[i-4] + article.body[i-3] + article.body[i-2] + article.body[i-1] + article.body[i]
                  if (string == 'src="'){
                    let char = ''
                    let o = 1
                    while (char != '"'){
                      char = article.body[i+o]
                      o++
                    }
                    const imgString = article.body.substring(i+1, i+o-1).replace('../', '')
                    metaTags = this.parsing.parseMetaTags(`${article.headline}`, article.subhead, 'articulo/', imgString)
                    i = article.body.length
                  }
                }
              }
            }else{
              metaTags = this.parsing.parseMetaTags(`${article.headline}`, article.subhead, 'articulo/')
            }
          } else {
            wrapper = '<h1>404 😥</h1> <p>No encontramos ese articulo, pero quizás encontrés algo interesante <a href="../">aquí</a></p>'
            metaTags = this.parsing.parseMetaTags('404 😥', 'No encontramos ese articulo', 'articulo/')
          }

          const view = {'metaTags': metaTags, 'wrapper': wrapper}
          const site = mustache.render(MasterTemplate, view)
          res.send(site)
        }
      })
    })

    router.patch('/articulo', (req: express.Request, res: express.Response) => {
      if (req.session.name) {
        const data: any = req.body
        const query = `CALL public.update_article('${data.subhead.replace(/`/g, '\x60').replace(/'/g, '&#39;')}', '${data.headline.replace(/`/g, '\x60').replace(/'/g, '&#39;')}', '${data.body.replace(/`/g, '\x60').replace(/'/g, '&#39;')}', '${data.author.replace(/`/g, '\x60').replace(/'/g, '&#39;')}', '${data.category.replace(/`/g, '\x60').replace(/'/g, '&#39;')}', '${data.pkHeadline}')`
          pgClient.query(query, (pgerror, pgresult) => {
            if (pgerror) {
              res.json({
                'success': false,
                'data': pgerror
              })
            } else {
              res.json({
                'success': true,
                'data': pgresult
              })
            }
          })
      } else {
        return res.status(401).send('Unathorized access, credentials expired or invalid.')
      }
    })

    router.post('/articulo', (req: express.Request, res: express.Response) => {
      if (req.session.name) {
        const data: any = req.body
        const query = `CALL public.insert_article('${data.subhead.replace(/`/g, '\x60').replace(/'/g, '&#39;')}', '${data.headline.replace(/`/g, '\x60').replace(/'/g, '&#39;')}', '${data.body.replace(/`/g, '\x60').replace(/'/g, '&#39;')}', '${data.author.replace(/`/g, '\x60').replace(/'/g, '&#39;')}', '${data.category.replace(/`/g, '\x60').replace(/'/g, '&#39;')}', '${data.date.replace(/`/g, '\x60').replace(/'/g, '&#39;')}', '${data.user.replace(/`/g, '\x60').replace(/'/g, '&#39;')}')`
          pgClient.query(query, (pgerror, pgresult) => {
            if (pgerror) {
              res.json({
                'success': false,
                'data': pgerror
              })
            } else {
              res.json({
                'success': true,
                'data': pgresult
              })
            }
          })
      } else {
        return res.status(401).send('Unathorized access, credentials expired or invalid.')
      }
    })

    router.delete('/articulo', (req: express.Request, res: express.Response) => {
      if (req.session.name) {
        const data: any = req.body
        const query = `CALL public.delete_article('${data.headline.replace(/`/g, '\x60').replace(/'/g, '&#39;')}')`
          pgClient.query(query, (pgerror, pgresult) => {
            if (pgerror) {
              res.json({
                'success': false,
                'data': pgerror
              })
            } else {
              res.json({
                'success': true,
                'data': pgresult
              })
            }
          })
      } else {
        return res.status(401).send('Unathorized access, credentials expired or invalid.')
      }
    })

    this.app.use('/', router)
  }

  /**
   * All routes related to reviews are defined here.
   * @param {express.Router} router - Router, new instance of expres.Router() by default.
   */
  reviewRoutes(router: express.Router = express.Router()) {
    router.get('/json/califica/universidades', (req: express.Request, res: express.Response) => {
      pgClient.query(`SELECT * FROM public.universities_review_summary`, (error, result) => {
        if (error) {
          res.status(500).send(error)
        } else {
          res.status(200).send(result.rows)
        }
      })
    })

    router.get('/json/califica', (req: express.Request, res: express.Response) => {
      pgClient.query(`SELECT * FROM public.universities_review_verified`, (error, result) => {
        if (error) {
          res.status(500).send(error)
        } else {
          res.status(200).send(result.rows)
        }
      })
    })

    router.get('/json/universidades', (req: express.Request, res: express.Response) => {
      pgClient.query('SELECT * FROM universities', (error, result) => {
        if (error) {
          res.status(500).send(error)
        } else {
          res.status(200).send(result.rows)
        }
      })
    })

    /*router.get('/json/califica/catedraticos/:name', (req: express.Request, res: express.Response) => {

    })*/

    router.get('/json/califica/universidades/:university/catedraticos', (req: express.Request, res: express.Response) => {
      let limit = parseInt(req.query.limit) || 20
      pgClient.query(`SELECT * FROM university_teachers('${req.params.university}') LIMIT ${limit}`, (error, result) => {
        if (error) {
          res.status(500).send(error)
        } else {
          res.status(200).send(result.rows)
        }
      })
    })

    router.get('/califica/universidades/:university', (req: express.Request, res: express.Response) => {
      //res.status(200).send(req.params.university)
      pgClient.query(`SELECT * FROM university_summary('${req.params.university}')`, (error, result) => {
        if (error) {
          res.status(200).send(error)
        } 
        if (result.rows.length > 0) {
          const metaTags = this.parsing.parseMetaTags(req.params.university, `${result.rows[0].university} | ${result.rows[0].summary}`, 'califica/universidades/')
          const wrapper = this.parsing.parseUniversity(result.rows[0])
          const view = {'metaTags': metaTags, 'wrapper': wrapper}
          const site = mustache.render(MasterTemplate, view)
          res.send(site)
        } else {
          const wrapper = '<h1>404 😥</h1> <p>No encontramos ese articulo, pero quizás encontrés algo interesante <a href="../">aquí</a></p>'
          const metaTags = this.parsing.parseMetaTags('404 😥', 'No encontramos ese articulo', 'articulo/')
          const view = {'metaTags': metaTags, 'wrapper': wrapper}
          const site = mustache.render(MasterTemplate, view)
          res.send(site)
        }
      })
    })

    router.get('/json/califica/universidades/:university', (req: express.Request, res: express.Response) => {
      pgClient.query(`SELECT * FROM university_summary('${req.params.university}')`, (error, result) => {
        if (error) {
          res.status(200).send(error)
        } 
        this.parsing.parseUniversity(result.rows[0])
        res.send(result.rows)
      })
    })

    router.get('/califica/universidades/:university/reviews', (req: express.Request, res: express.Response) => {
      const page = parseInt(req.params.page) || 0
      pgClient.query(`SELECT * FROM university_reviews_paging('${req.params.university}', ${page})`, (error, result) => {
        if (error) {
          res.status(500).send(error)
        } else {
          for (let i: number = 0; i < result.rowCount; i++) {
            result.rows[i].date = JSON.stringify(result.rows[i].date).substr(1, 10)
          }
          const view = {reviews: result.rows}
          const template = fs.readFileSync(path.resolve(__dirname, 'templates/reviews/reviews.html'), 'utf8')

          const site = mustache.render(template, view)
          res.status(200).send({length: result.rowCount, html: site})
        }
      })
    })

    router.get('/califica/universidades', (req: express.Request, res: express.Response) => {
      res.sendFile(path.resolve(__dirname, '../view/califica.html'))
    })

    router.post('/califica/universidades', (req: express.Request, res: express.Response) => {
      const captchaSK = process.env.CAPTCHA
      axios.post(`https://www.google.com/recaptcha/api/siteverify?secret=${captchaSK}&response=${req.body.captcha}`)
      .then((axres: AxiosResponse) => {
        const success: boolean = axres.data.success
        const data: any = req.body
        let result: Array<any>

        if (success === true && axres.data.score > 0.5) {
          const query = `CALL public.insert_university_review('${data.university.replace(/[&()'"*]/g, '')}', ${data.reputation}, ${data.location}, ${data.events}, ${data.security}, ${data.services}, ${data.cleanliness}, ${data.happiness}, '${data.summary}', ${data.social}, ${data.extracurricular})`
          pgClient.query(query, (pgerror, pgresult) => {
            if (pgerror) {
              res.json({
                'success': false,
                'data': pgerror
              })
            } else {
              res.json({
                'success': success,
                'data': pgresult
              })
            }
          })
        } else {
          res.json({
            'success': success,
            'data': result
          })
        }
      }).catch((error: AxiosError) => {
        res.json({
          'success': false,
          'data': error
        })
      })
    })

    router.patch('/califica/universidades', (req: express.Request, res: express.Response) => {
      if (req.session.name) {
        if (req.query.university && req.query.date) {
          const query = `CALL validate_review('${req.query.university}', '${req.query.date}')`
          pgClient.query(query, (pgerror, pgresult) => {
            if (pgerror) {
              return res.status(500).send({'success': false, 'error': pgerror})
            } else {
              return res.status(200).send({'success': true, 'data': pgresult})
            }
          })
        } else {
          return res.status(400).send('Insufficient parameters sent.')
        }
      } else {
        return res.status(401).send('Unathorized access, credentials expired or invalid.')
      }
    })

    router.patch('/califica/universidades/vote', (req: express.Request, res: express.Response) => {
      const captchaSK = process.env.CAPTCHA
      if (req.body.vote && req.body.university && req.body.date) {
        axios.post(`https://www.google.com/recaptcha/api/siteverify?secret=${captchaSK}&response=${req.body.captcha}`)
        .then((axres: AxiosResponse) => {
          const success: boolean = axres.data.success
          let result: Array<any>

          if (success === true && axres.data.score > 0.5) {
            const query = `CALL vote_uni_review('${req.body.university}', '${req.body.date}', ${req.body.vote})`
            pgClient.query(query, (pgerror, pgresult) => {
              if (pgerror) {
                return res.status(500).send({'success': false, 'error': pgerror})
              } else {
                return res.status(200).send({'success': true, 'data': pgresult})
              }
            })
          } else {
            return res.status(200).send({'success': true, 'data': []})
          }
        })
      } else {
        return res.status(400).send('Insufficient parameters sent.')
      }
    })

    router.delete('/califica/universidades', (req: express.Request, res: express.Response) => {
      if (req.session.name){
        if (req.query.university && req.query.date) {
          const query = `CALL delete_university_review('${req.query.university}', '${req.query.date}')`
          pgClient.query(query, (pgerror, pgresult) => {
            if (pgerror) {
              return res.status(500).send({'success': false, 'error': pgerror})
            } else {
              return res.status(200).send({'success': true, 'data': pgresult})
            }
          })
        } else {
          return res.status(400).send('Insufficient parameters sent.')
        }
      } else {
        return res.status(401).send('Unathorized access, credentials expired or invalid.')
      }
    })

    router.get('/califica', (req: express.Request, res: express.Response) => {
      res.redirect('/califica/universidades')
    })

    this.app.use('/', router)
  }

  /**
   * All global and general routes are defined here,
   * routes that are on the root directory or used by all sections.
   * @param {express.Router} router - Router, new instance of expres.Router() by default.
   */
  generalRoutes(router: express.Router = express.Router()) {
    router.get('/json/categories', (req: express.Request, res: express.Response) => {
      pgClient.query(`SELECT "CATEGORY", "LABEL" FROM public."CATEGORY"`, (error, result) => {
        if (error) {
          res.status(500).send(error)
        } else {
          let data = []
          for (let row of result.rows) {
            data.push(row)
          }
          res.status(200).send(data)
        }
      })
    })

    router.get('/json/:category', (req: express.Request, res: express.Response) => {
      pgClient.query(`SELECT * FROM public."ARTICLE" WHERE category = '${req.params.category}' ORDER BY created DESC`, (error, result) => {
        if (error) {
          res.status(500).send(error)
        } else {
          let data = []
          for (let row of result.rows) {
            data.push(row)
          }
          res.status(200).send(data)
        }
      })
    })

    router.get('/nosotros', (req: express.Request, res: express.Response) => {
      res.sendFile(path.resolve(__dirname, '../view/nosotros.html'))
    })

    router.get('/:category', (req: express.Request, res: express.Response) => {
      let page: number = 0
      const pageBoundary: number = 10
      if (!isNaN(req.query.page)){
        page = parseInt(req.query.page)
      }

      pgClient.query(`SELECT * FROM category_articles_paging('${req.params.category}', ${page * (pageBoundary)}, ${pageBoundary + 1});`, (error, result) => {
        
        if (error) {
          res.status(500).send(error)
        } else {
          let data = []
          for (let i = 0; i < result.rowCount && i < pageBoundary; i++) {
            data.push(result.rows[i])
          }

          if (result.rowCount === 0){
            const wrapper: string = '<h1>404 😥</h1> <p>No encontramos ese articulo, pero quizás encontrés algo interesante <a href="../">aquí</a></p>'
            const metaTags: string = this.parsing.parseMetaTags('404 😥', 'No encontramos ese articulo', 'articulo/')
            const view = {'metaTags': metaTags, 'wrapper': wrapper}
            const site: string = mustache.render(MasterTemplate, view)
            res.send(site)

          } else {
            let paging: string = ''
            if (page > 0){
              paging += '<button class="pager" id="less" onClick="lessPage()">Menos articulos</button>'
            }
            if (result.rowCount === pageBoundary + 1) {
              paging += '<button class="pager" id="more" onClick="addPage()">Más articulos</button>'
            }            

            let wrapper: string = ''
            for (let i = 0; i < data.length; i++){
              wrapper += this.parsing.parseArticle(data[i].headline, data[i].subhead, data[i].body, data[i].date, data[i].author);
            }
            const metaTags: string = this.parsing.parseMetaTags('', '', '')
            const view = {
              'metaTags': metaTags, 
              'wrapper': wrapper, 
              'paging': paging
            }
            const site: string = mustache.render(MasterTemplate, view)
            res.send(site)
          }
        }
      })
    })

    router.get('/', (req: express.Request, res: express.Response)=>{
      res.redirect('/opinion')
    })

    this.app.use('/', router)
  }

  dashboardRoutes(router: express.Router = express.Router()) {
    router.get('/dashboard/login', (req: express.Request, res: express.Response)=>{
      if (req.query.username && req.query.password) {
        const query = `SELECT * FROM validate_credential('${req.query.username.replace(/[&()'"*]/g, '')}', '${req.query.password.replace(/[&()'"*]/g, '')}')`
        pgClient.query(query, (pgerror, pgresult) => {
          if (pgerror) {
            return res.status(500).send({error: pgerror.message})
          } else {
            if (pgresult.rowCount == 0) {
              return res.status(200).send(false)
            } else {
              req.session.name = req.query.username
              return res.status(200).send(pgresult.rows[0].password)
            }
          }
        })
      } else {
        return res.status(400).send({error: 'Invalid request, missing query parameters'})
      }
    })

    router.get('/dashboard/session', (req: express.Request, res: express.Response)=>{
      if (!req.session.name) {
        return res.status(200).send(false)
      } else {
        return res.status(200).send(true)
      }
    })

    router.delete('/dashboard/session', (req: express.Request, res: express.Response)=>{
      req.session.destroy((err)=> {
        if (err) {
          return res.json({
            'success': false,
            'status': 'Unable to destroy session'
          })
        }
        return res.json({
          'success': true,
          'status': 'Session succesfully destroyed'
        })
      })
    })

    router.get('/dashboard/articles',(req: express.Request, res: express.Response)=>{
      if (req.session.name) {
        pgClient.query(`SELECT views, subhead, body, headline, author, category, date FROM "ARTICLE" WHERE created_by = '${req.session.name}' ORDER BY created DESC`, (pgerror, pgresult) => {
          if (pgerror) {
            return res.status(500).send({error:pgerror})
          }
          const template = fs.readFileSync(path.resolve(__dirname, 'templates/dashboard/profile.html'), 'utf8')
          for (let i = 0; i < pgresult.rowCount; i++) {
            pgresult.rows[i].body = pgresult.rows[i].body.replace(/`/g, '&96;')
          }
          const view = {'articles': pgresult.rows}
          const site = mustache.render(template, view)
          return res.send(site)
        })
      } else {
        res.status(401).send('Unathorized access, credentials expired or invalid.')
      }
    })

    router.get('/dashboard/moderation', (req: express.Request, res: express.Response)=>{
      if (req.session.name) {
        pgClient.query('SELECT * FROM university_unverified_reviews()', (pgerror, pgresult) => {
          if (pgerror) {
            return res.status(500).send({error:pgerror})
          }
          const template = fs.readFileSync(path.resolve(__dirname, 'templates/dashboard/moderation.html'), 'utf8')
          for (let i = 0; i < pgresult.rowCount; i ++) {
            const jsDate = new Date(pgresult.rows[i].date)
            //const sqlDate = `${jsDate.getUTCFullYear()}-${jsDate.getUTCMonth()}-${jsDate.getUTCDate()} ${jsDate.getUTCHours()}:${jsDate.getUTCMinutes()}:${jsDate.getUTCSeconds()}.${jsDate.getUTCMilliseconds()}+00`
            const sqlDate = jsDate.toISOString().replace('T', ' ').replace('Z', '');
            pgresult.rows[i].date = sqlDate
          }
          const view = {'categories': [{name: 'calificacion'}], 'reviews': pgresult.rows}
          const site = mustache.render(template, view)
          return res.send(site)
        })
      } else {
        res.status(401).send('Unathorized access, credentials expired or invalid.')
      }
    })
    
    router.patch('/dashboard/user', (req: express.Request, res: express.Response)=>{
      if (req.session.name) {
        if (req.query.username && req.query.password) {
          const query = `CALL update_credential('${req.query.username.replace(/[&()'"*]/g, '')}', '${req.query.password.replace(/[&()'"*]/g, '')}')`
          pgClient.query(query, (pgerror, pgresult) => {
            if (pgerror) {
              console.log(pgerror)
              return res.status(500).send({error: pgerror})
            } else {
              return res.status(200).send({success: true, data: pgresult.rows})
            }
          })
        } else {
          return res.status(400).send({error: 'Invalid request, missing query parameters'})
        }
      } else {
        res.status(401).send('Unathorized access, credentials expired or invalid.')
      }
    })
    this.app.use('/', router)
  }
}

/**
 * Replaces all instances of a substring with another string.
 * @param {string} str - Initial complete string
 * @param {sting} find - Substring to find all instances of
 * @param {string} replace - Substring to replace with
 */
function replaceAll(str: string, find: string, replace: string) {
  return str.replace(new RegExp(find, 'g'), replace);
}

//Export app
export default new App()