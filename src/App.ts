import { createServer, Server } from 'http'
import express from 'express'
import cors from 'cors'
import * as path from 'path'

var redis = require('redis')
var client = redis.createClient(process.env.REDIS_URL);

const indexStart = '<!DOCTYPE html><html><head>'
const indexContent = '<meta charset="utf-8"><meta http-equiv="X-UA-Compatible" content="IE=edge"><meta name="viewport" content="width=device-width, initial-scale=1"><script async src="//pagead2.googlesyndication.com/pagead/js/adsbygoogle.js"></script><script>(adsbygoogle = window.adsbygoogle || []).push({google_ad_client: "ca-pub-1298512778914438",enable_page_level_ads: true});</script><link rel="stylesheet" type="text/css" media="screen" href="main.css"><script src="main.js"></script></head><body><div class="header"><h1>EL SINDICATO</h1><ul class="links"><li><a href="../">OPINIÓN</a></li><li><a href="nosotros.html">NOSOTROS</a></li></ul></div><div id="wrapper">'
const indexEnd = '</div></body></html>'

class App{
  public server: Server
  public app: express.Application
  constructor () {
    // App Express
    this.app = express()
    // Load static files
    this.app.use(express.static(path.resolve(__dirname, '../view')))
    // Mount extra routes
    this.mountRoutes()
    // Http Server
    this.server = createServer(this.app)

    // Database connection error test
    client.on('error', (err: any)=>{
      console.log('Something went wrong on redis ', err)
    })
  }

  mountRoutes(){
    const router: express.Router = express.Router()
    router.get('/json/opinion', (req: express.Request, res: express.Response) => {
      client.lrange('opinions', 0, -1, function(err: any, reply: any) {
        if (err){
          res.status(500).send(err)
        }
        res.send(parseSection(reply))
      })
    })

    router.get('/json/:article', (req: express.Request, res: express.Response) => {
      client.get(decodeURI(req.params.article), (error: any, result: any)=>{
        if (error){
          res.status(500).send(error)
        }
        res.send(result)
      })
    })

    router.get('/categories', (req: express.Request, res: express.Response) => {
      client.lrange('categories', 0, -1, function(err: any, reply: any) {
        res.send(parseSection(reply))
      })
    })

    router.get('/opinion', (req: express.Request, res: express.Response) => {
      const pager: string = '<button class="pager" id="more" onClick="addPage()">Más articulos</button><button class="pager" id="less" onClick="lessPage()">Menos articulos</button>'
      let page: number = 0
      let articles
      if (!isNaN(req.query.page)){
        page = parseInt(req.query.page)
      }

      client.lrange('opinions', 0, -1, function(err: any, reply: any) {
        if (err){
          res.status(500).send(err)
        }
        const maxPage = Math.floor(reply.length/10)
        if (page > maxPage || page < 0){
          page = 0
        }

        let end: string = indexEnd

        if (reply.length > (page + 1) * 10){
          end = spliceSlice(end, 6, 0, '<button class="pager" id="more" onClick="addPage()">Más articulos</button>')
        }
        if (page > 0){
          end = spliceSlice(end, 6, 0, '<button class="pager" id="less" onClick="lessPage()">Menos articulos</button>')
        }

        articles = parseSection(reply.slice(0 + (10 * page), 11 + (10 * page)))
        let wrapper: string = ''
        for (let i = 0; i < articles.length; i++){
          wrapper += parseArticle(articles[i].headline, articles[i].subhead, articles[i].body, articles[i].date, articles[i].author);
        }

        const metaTags = parseMetaTags('', '')
        res.send(`${indexStart}${metaTags}${indexContent}${wrapper}${end}`)
        //const end = spliceSlice(indexEnd, 6, 0, wrapper)
        //console.log(end)
        //res.json(articles)
      })
    })

    router.get('/nosotros', (req: express.Request, res: express.Response) => {
      res.sendFile(path.resolve(__dirname, '../view/nosotros.html'))
    })

    router.get('/:article', (req: express.Request, res: express.Response) => {
      let article: {date: string, author: string, headline: string, subhead: string, body: string, visits: number}
      let wrapper: string
      let metaTags: string
      client.get(decodeURI(req.params.article), (error: any, result: any)=>{
        if (error){
          res.status(500).send(error)
        }
        if (result != null){
          article = JSON.parse(result)
          wrapper = parseArticle(article.headline, article.subhead, article.body, article.date, article.author)
          article.visits += 1
          console.log(`Articulo visitado: ${decodeURI(req.params.article)}`)
          client.set(decodeURI(req.params.article), JSON.stringify(article), redis.print)
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
                  console.log(imgString)
                  metaTags = parseMetaTags(`${article.headline}`, article.subhead, imgString)
                  i = article.body.length
                }
              }
            }
          }else{
            metaTags = parseMetaTags(`${article.headline}`, article.subhead)
          }
        }else{
          wrapper = '<h1>404 😥</h1> <p>No encontramos ese articulo, pero quizás encontrés algo interesante <a href="../">aquí</a></p>'
          metaTags = parseMetaTags('404 😥', 'No encontramos ese articulo')
        }
        
        res.send(`${indexStart}${metaTags}${indexContent}${wrapper}${indexEnd}`)
      })
    })

    router.delete('/delete', (req: express.Request, res: express.Response)=>{
      if (req.query.pwd == process.env.WRITE_PWD){
        client.lindex(decodeURI(req.query.category), req.query.index,(error: any, result: any)=>{
          client.lrem(decodeURI(req.query.category), 1, result, redis.print)
          client.del(req.query.article)
          res.status(303).send(result)
        })
      }else{
        console.log('wrong pwd:', req.query.pwd)
        res.status(403).send("You don't have permission to delete articles on this server")
      }
    })

    router.post('/upload', (req: express.Request, res: express.Response)=>{
      if (req.query.pwd == process.env.WRITE_PWD){
        console.log(req.query.body)
        const newArticle: {
          date: string, 
          author: string, 
          headline: string, 
          subhead: string, 
          body: string, 
          visits: number
        } = {
          date: req.query.date, 
          author: req.query.author, 
          headline: req.query.headline, 
          subhead: req.query.subhead,
          body: req.query.body,
          visits: 0
        }
        client.set(req.query.headline, JSON.stringify(newArticle), redis.print)
        client.lpush(req.query.category, JSON.stringify(newArticle) , redis.print)
        res.send({'article': newArticle})
      }else{
        console.log('wrong pwd:', req.query.pwd)
        res.status(403).send("You don't have permission to upload articles on this server")
      }
    })

    router.get('/', (req: express.Request, res: express.Response)=>{
      res.redirect('/opinion')
    })

    this.app.use('/', router)
  }
}

function parseArticle(headline: string, subhead: string, body: string, date: string, author:string): string{
  const article = `
  <div class="content">
    <h1><a href="${encodeURIComponent(headline)}">${headline}</a></h1>
    <p class="info"><b>${author}</b>  -  ${date}</p>
    <p class="subhead">${subhead}</p>
    <hr>
    <div class="body">${body}</div>
    <hr>
  </div>
  `
  return article
}

function parseSection(unparsedArticles: Array<string>): Array<{date: string, author: string, headline: string, subhead: string, body: string, visits: number}>{
  let parsedArticles: Array<{
    date: string, 
    author: string, 
    headline: string, 
    subhead: string, 
    body: string, 
    visits: number
  }> = []
  for (let i = 0; i < unparsedArticles.length; i++){
    const opinion: {date: string, author: string, headline: string, subhead: string, body: string, visits: number} = JSON.parse(unparsedArticles[i])
    parsedArticles.push(opinion)
  }

  return parsedArticles
}

function parseMetaTags(title: string, description: string, img: string = 'sindicato-icon-240x240.png'): string{
  return `
    <title>| El Sindicato | ${title}</title>
    <meta name="title" content="${title}">
    <meta name="description" content="${description}">
    <meta property="og:title" content="${title}">
    <meta property="og:description" content="${description}">
    <meta property="og:image" content="http://www.sindicato-ufm.com/${img}">
    <meta property="og:type" content="article">
    <meta property="og:locale" content="es_ES">    
    <meta property="og:url" content="http://www.sindicato-ufm.com/${encodeURIComponent(title)}">
    <meta name="google-site-verification" content="jMeI7ML27XYuoifj0zX0IOkJDRe5qnu0Mv1SI2kUOLI" />
    `
}

function spliceSlice(str: string, index: number, count: number, add: any):string {
  if (index < 0) {
    index = str.length + index;
    if (index < 0) {
      index = 0;
    }
  }

  return str.slice(0, index) + (add || "") + str.slice(index + count);
}

//Export app
export default new App()