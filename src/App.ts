import { createServer, Server } from 'http'
import { Client, QueryResult } from 'pg'

import express from 'express'
import session from 'express-session'
import connectReddis from 'connect-redis'

import compression, { filter } from 'compression'

import * as path from 'path'
import bodyParser from 'body-parser'
import axios, { AxiosResponse, AxiosError } from 'axios'
import redis from 'redis'
import fs from 'fs'

import mustache from 'mustache'

// All main parsing imports
import { Parsing } from './Parsing'
import { ArticleComponent } from './components/article/Article'
import { MetaTagsComponent } from './components/metaTags/MetaTags'
import { MasterComponent } from './components/master/Master'
import { ArticleController } from './controller/articles/article.controller'

const client = redis.createClient(process.env.REDIS_URL)
const RedisStore = connectReddis(session)



const pgClient = new Client({
  connectionString: process.env.DATABASE_URL,
  ssl: true,
})

interface select {
  val: string, caption: string, selected: string
}

class App{
  public server: Server
  public app: express.Application
  public parsing: Parsing = new Parsing()
  
  private rateTeacherQs = [
    {
      index: 1,
      question: 'Calificación general del catédratico',
      val: 'rate',
      caption: 'Calificación'
    },
    {
      index: 2,
      question: '¿Cuál es la dificultad de ganar con el catédratico?',
      val: 'difficulty',
      caption: 'Dificultad'
    },
    {
      index: 3,
      question: '¿Qué tan accesible es el catedratico?',
      val: 'accessibility',
      caption: 'Accesibilidad'
    }
  ]

  constructor () {
    // App Express
    this.app = express()

    // Use compression
    this.app.use(compression())

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
    const articleController = new ArticleController(this.app, pgClient)
    articleController.articleRoutes()

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

    router.get('/json/califica/catedraticos/filter', (req: express.Request, res: express.Response) => {
      if (req.query.search) {
        let query = `SELECT * FROM filter_teachers('${req.query.search.replace(/[&()\-'"*]/g, '')}')`

        if (req.query.university) {
          query += ` WHERE university = '${req.query.university.replace(/[&()\-'"*]/g, '')}'`
        }
        pgClient.query(query, (error, result: any) => {
          if (error) {
            return res.status(500).send(error)
          } else {
            return res.status(200).send(result.rows)
          }
        })
      } else {
        return res.status(400).send('Insufficient parameters sent.')
      }
    })

    router.get('/json/califica/universidades/:university/catedraticos', (req: express.Request, res: express.Response) => {
      let limit = parseInt(req.query.limit) || 20
      pgClient.query(`SELECT * FROM university_teachers('${req.params.university.replace(/[&()\-'"*]/g, '')}') LIMIT ${limit}`, (error, result) => {
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
          const metaTags = new MetaTagsComponent({
            title: req.params.university,
            description: `${result.rows[0].university} | ${result.rows[0].summary}`,
            titleLink: 'califica/universidades/'
          })

          const wrapper = this.parsing.parseUniversity(result.rows[0])

          const site = new MasterComponent({
            metaTagsComponent: metaTags,
            paging: '',
            wrapper: wrapper
          }).render()

          res.send(site)
        } else {
          const wrapper = '<h1>404 😥</h1> <p>No encontramos ese articulo, pero quizás encontrés algo interesante <a href="../">aquí</a></p>'
          
          const metaTags = new MetaTagsComponent({
            title: '404 😥',
            description: 'No encontramos ese articulo',
            titleLink: 'articulo/'
          })

          const site = new MasterComponent({
            metaTagsComponent: metaTags,
            paging: '',
            wrapper: wrapper
          }).render()

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
          const starTemplate = fs.readFileSync(path.resolve(__dirname, 'components/reviews/stars.html'), 'utf8')
          for (let i: number = 0; i < result.rowCount; i++) {
            result.rows[i].stars = mustache.render(starTemplate, { fill: Array(Math.round(result.rows[i].rate)).fill(''), empty: Array(5 - Math.round(result.rows[i].rate)).fill('')})
            result.rows[i].date = JSON.stringify(result.rows[i].date).substr(1, 24)
            result.rows[i].dateText = result.rows[i].date.substr(0, 10)
          }
          const view = {reviews: result.rows}
          const template = fs.readFileSync(path.resolve(__dirname, 'components/reviews/uni-reviews.html'), 'utf8')

          const site = mustache.render(template, view)
          res.status(200).send({length: result.rowCount, html: site})
        }
      })
    })

    router.get('/califica/filtro', (req: express.Request, res: express.Response) => {
      const possibleOrders = ['asc', 'desc']
      
      req.query.nombre = req.query.nombre == null ? '' : req.query.nombre
      req.query.clase = req.query.clase == null ? '' : req.query.clase
      req.query.universidad = req.query.universidad == null ? '' : req.query.universidad
      req.query.orden = req.query.orden == null || !possibleOrders.includes(req.query.orden) ? 'asc' : req.query.orden

      for (const query in req.query) {
        req.query[query] = req.query[query].replace(/[&()\-;'"*]/g, '')
      }

      const reviewFilter = fs.readFileSync(path.resolve(__dirname, 'components/reviews/review-filter.html'), 'utf8')
      const filterInfo: {name: string, class: string, universities: Array<select>, orders: Array<select>, teachers: any, reviewModal: string} = {
        name: req.query.nombre,
        class: req.query.clase,
        universities: [],
        orders: [],
        teachers: [],
        reviewModal: fs.readFileSync(path.resolve(__dirname, 'components/reviews/new-treview.html'), 'utf8')
      }

      const orders = [
        {val: 'asc', caption: 'Ascendente', selected: ''},
        {val: 'desc', caption: 'Descendente', selected: ''}
      ]
      for (let i = 0; i < 2; i++) {
        if (req.query.orden === orders[i].val) {
          orders[i].selected = 'selected'
        }
        filterInfo.orders.push(orders[i])
      }
      
      pgClient.query(`SELECT * FROM filter_teacher_reviews('${req.query.universidad}', '${req.query.nombre}', '${req.query.clase}', 0) ORDER BY rate_avg ${req.query.orden}; SELECT name as caption, acronym as val FROM universities;`, (error, result: any) => {
        if (error) {
          res.status(500).send(error)
        } else {
          const teachersView = []
          for (let i = 0; i < result[0].rows.length; i++) {
            const teacher = {
              name: result[0].rows[i].teacher,
              rating: this.parsing.starRatingParser(result[0].rows[i].rate_avg, 5),
              summary: result[0].rows[i].review
            }

            teachersView.push(teacher)
          }

          filterInfo.teachers = teachersView

          for (let i = 0; i < result[1].rowCount; i++) {
            if (req.query.universidad === result[1].rows[i].val) {
              result[1].rows[i].selected = 'selected'
            }
          }

          filterInfo.universities = result[1].rows

          const modalView = {
            questions: this.rateTeacherQs,
            universities: result[1].rows
          }

          filterInfo.reviewModal = mustache.render(filterInfo.reviewModal, modalView)

          const wrapper = mustache.render(reviewFilter, filterInfo)

          const site = this.parsing.parseGeneric(wrapper, 'Calificá y compará tu U, cursos y catedraticos', '', 'califica/catedratico')

          res.status(200).send(site)
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
          const query = `CALL public.insert_university_review('${data.university.replace(/[&()\-'"*]/g, '')}', ${data.reputation}, ${data.location}, ${data.events}, ${data.security}, ${data.services}, ${data.cleanliness}, ${data.happiness}, '${data.summary.replace(/[&'"*]/g, '')}', ${data.social}, ${data.extracurricular})`
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
          const query = `CALL validate_review('${req.query.university.replace(/[&()\-'"*]/g, '')}', '${req.query.date.replace(/[&()\-'"*]/g, '')}')`
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
      let sessionVotes = req.session.votes || []
      if (sessionVotes.includes(req.body.date)) {
        return res.status(200).send({'success': false, 'data': [1, 'Session already voted for this review.']})
      } else {
        if (req.body.vote && req.body.university && req.body.date && req.body.captcha) {
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
                  sessionVotes.push(req.body.date)
                  req.session.votes = sessionVotes
                  return res.status(200).send({'success': true, 'data': pgresult})
                }
              })
            } else {
              console.log('bot:', axres.data.score)
              return res.status(200).send({'success': false, 'data': [0, 'Possible bot detected']})
            }
          })
        } else {
          return res.status(400).send('Insufficient parameters sent.')
        }
      }
    })

    router.delete('/califica/universidades', (req: express.Request, res: express.Response) => {
      if (req.session.name){
        if (req.query.university && req.query.date) {
          const query = `CALL delete_university_review('${req.query.university.replace(/[&()\-'"*]/g, '')}', '${req.query.date.replace(/[&()\-'"*]/g, '')}')`
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
    router.get('/session/destroy', (req: express.Request, res: express.Response) => {
      if (req.session.name) {
        req.session.destroy(() => {
          res.send(';)')
        })
      } else {
        res.send(':(')
      }
    })

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
      const pageBoundary: number = 6
      if (!isNaN(req.query.page)){
        page = parseInt(req.query.page)
      }

      pgClient.query(`SELECT * FROM category_articles_paging('${req.params.category.replace(/[&()'";*]/g, '')}', ${page * (pageBoundary)}, ${pageBoundary + 1});`, (error, result) => {
        
        if (error) {
          res.status(500).send(error)
        } else {
          let data = []
          for (let i = 0; i < result.rowCount && i < pageBoundary; i++) {
            data.push(result.rows[i])
          }

          if (result.rowCount === 0){
            const wrapper = '<h1>404 😥</h1> <p>No encontramos ese articulo, pero quizás encontrés algo interesante <a href="../">aquí</a></p>'
          
            const metaTags = new MetaTagsComponent({
              title: '404 😥',
              description: 'No encontramos ese articulo',
              titleLink: 'articulo/'
            })

            const site = new MasterComponent({
              metaTagsComponent: metaTags,
              paging: '',
              wrapper: wrapper
            }).render()

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
              //wrapper += this.parsing.parseArticle(data[i].headline, data[i].subhead, data[i].body, data[i].date, data[i].author);

              wrapper += new ArticleComponent({
                headline: data[i].headline,
                headlineLink: encodeURIComponent(data[i].headline.replace(/ /g, '-')),
                author: data[i].author,
                date: data[i].date,
                subhead: data[i].subhead,
                body: data[i].body
              }).render()
            }

            const metaTags = new MetaTagsComponent({
              title: capitalize(req.params.category),
              description: '',
              titleLink: ''
            })
  
            const site = new MasterComponent({
              metaTagsComponent: metaTags,
              paging: paging,
              wrapper: wrapper
            }).render()
  
            res.send(site)
          }
        }
      })
    })

    router.get('/', (req: express.Request, res: express.Response)=>{
      let page: number = 0
      const pageBoundary: number = 6
      if (!isNaN(req.query.page)){
        page = parseInt(req.query.page)
      }

      pgClient.query(`SELECT * FROM category_articles_paging('opinion', ${page * (pageBoundary)}, ${pageBoundary + 1});`, (error, result) => {
        
        if (error) {
          res.status(500).send(error)
        } else {
          let data = []
          for (let i = 0; i < result.rowCount && i < pageBoundary; i++) {
            data.push(result.rows[i])
          }

          if (result.rowCount === 0){
            const wrapper = '<h1>404 😥</h1> <p>No encontramos ese articulo, pero quizás encontrés algo interesante <a href="../">aquí</a></p>'
          
            const metaTags = new MetaTagsComponent({
              title: '404 😥',
              description: 'No encontramos ese articulo',
              titleLink: 'articulo/'
            })

            const site = new MasterComponent({
              metaTagsComponent: metaTags,
              paging: '',
              wrapper: wrapper
            }).render()

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
              //wrapper += this.parsing.parseArticle(data[i].headline, data[i].subhead, data[i].body, data[i].date, data[i].author);

              wrapper += new ArticleComponent({
                headline: data[i].headline,
                headlineLink: encodeURIComponent(data[i].headline.replace(/ /g, '-')),
                author: data[i].author,
                date: data[i].date,
                subhead: data[i].subhead,
                body: data[i].body
              }).render()
            }

            const metaTags = new MetaTagsComponent({
              title: '',
              description: 'Somos es una plataforma independiente de estudiantes para poder exponer opiniones libres sin adoctrinamiento forzada.',
              titleLink: ''
            })
            
            const site = new MasterComponent({
              metaTagsComponent: metaTags,
              paging: paging,
              wrapper: wrapper
            }).render()

            res.send(site)
          }
        }
      })
    })

    this.app.use('/', router)
  }

  dashboardRoutes(router: express.Router = express.Router()) {
    router.get('/dashboard/login', (req: express.Request, res: express.Response)=>{
      if (req.query.username && req.query.password) {
        const query = `SELECT * FROM validate_credential('${req.query.username.replace(/[&()\-'"*]/g, '')}', '${req.query.password.replace(/[&()\-'"*]/g, '')}')`
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
          const template = fs.readFileSync(path.resolve(__dirname, 'components/dashboard/profile.html'), 'utf8')
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
          const template = fs.readFileSync(path.resolve(__dirname, 'components/dashboard/moderation.html'), 'utf8')
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
          const query = `CALL update_credential('${req.query.username.replace(/[&()\-'"*]/g, '')}', '${req.query.password.replace(/[&()\-'"*]/g, '')}')`
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

function capitalize(s: string) {
  if (typeof s !== 'string') return ''
  return s.charAt(0).toUpperCase() + s.slice(1)
}

//Export app
export default new App()